/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Context } from 'aws-lambda';
import { listPostChanges } from './listPostChanges';
import { CreateOp, DeleteOp, ids } from './firehoseSubscription/subscribe';
import type { Record as PostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import type { Record as RepostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/repost';
import {
  AggregateListRecord,
  batchGetAggregateListRecord,
} from '../../followingStore';
import { PostTableRecord, savePostsBatch } from '../../postsStore';

const processBatch = async (
  resolvedDids: Record<string, AggregateListRecord | false>,
  didsToResolve: ReadonlyArray<string>,
  posts: ReadonlyArray<CreateOp<PostRecord | RepostRecord>>,
  deletes: ReadonlyArray<DeleteOp>
) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const newlyResolvedDids = await batchGetAggregateListRecord(didsToResolve);
  didsToResolve.forEach(
    (did) => (resolvedDids[did] = newlyResolvedDids[did] ?? false)
  );

  let postsSaved = 0;
  let repostsSaved = 0;
  const postsToSave = posts
    .filter(({ author }) => {
      const rec = resolvedDids[author];
      if (!rec) return false;
      return rec.followedBy > 0;
    })
    .flatMap((post): Array<PostTableRecord> => {
      if (post.type === ids.AppBskyFeedRepost && post.record.subject != null) {
        repostsSaved++;
        return [
          {
            uri: post.uri,
            createdAt: post.record.createdAt,
            author: post.author,
            type: 'repost',
            resolvedStatus: 'UNRESOLVED',
            expiresAt,
            // @ts-expect-error
            repostedPostUri: post.record.subject.uri,
          },
        ];
      } else if (post.type === ids.AppBskyFeedPost) {
        postsSaved++;
        const textEntries: Array<string> = [];
        if (post.record.text != null) {
          textEntries.push(post.record.text as string);
        }
        // @ts-expect-error
        if (post.record.embed?.images != null) {
          // @ts-expect-error
          post.record.embed.images.forEach((image) => {
            if (image.alt) {
              textEntries.push(image.alt);
            }
          });
        }
        const isReply = post.record.reply != null;
        let startsWithMention = false;
        const mentionedDids: Array<string> = [];
        if (post.record.facets != null) {
          // @ts-expect-error
          post.record.facets.forEach((facet) => {
            if (facet.features != null) {
              // @ts-expect-error
              facet.features.forEach((feature) => {
                if (feature['$type'] === 'app.bsky.richtext.facet#mention') {
                  mentionedDids.push(feature.did);
                  if (facet.index?.byteStart === 0) {
                    startsWithMention = true;
                  }
                }
              });
            }
          });
        }
        const resolvedStatus = isReply ? 'UNRESOLVED' : 'RESOLVED';
        return [
          {
            uri: post.uri,
            createdAt: post.record.createdAt,
            author: post.author,
            type: 'post',
            resolvedStatus,
            expiresAt,
            ...(isReply
              ? {
                  isReply,
                  // @ts-ignore
                  replyRootUri: post.record.reply?.root?.uri,
                  // @ts-ignore
                  replyParentUri: post.record.reply?.parent?.uri,
                }
              : undefined),
            ...(startsWithMention ? { startsWithMention } : undefined),
            mentionedDids,
            textEntries,
          },
        ];
      }
      return [];
    });
  const deletesToApply = deletes
    .filter(({ author }) => Boolean(resolvedDids[author]))
    .map((del) => del.uri);
  await savePostsBatch(postsToSave, deletesToApply);
  return {
    postsSaved,
    repostsSaved,
    deletesApplied: deletesToApply.length,
  };
};

export const handler = async (_: unknown, context: Context): Promise<void> => {
  const maxReadTimeMillis = Math.floor(
    context.getRemainingTimeInMillis() * 0.8
  );

  console.log({ maxReadTimeMillis });

  const resolvedDids: Record<string, AggregateListRecord | false> = {};
  const didsToResolve = new Set<string>();

  let operationCount = 0;
  let posts: Record<string, CreateOp<PostRecord | RepostRecord>> = {};
  let deletes: Set<DeleteOp> = new Set();
  const start = new Date();
  let postsSaved = 0;
  let repostsSaved = 0;
  let deletesApplied = 0;
  let operationsSkipped = 0;
  let postsAndRepostsProcessed = 0;
  let deletesProcessed = 0;
  for await (const op of listPostChanges({ maxReadTimeMillis })) {
    const { author } = op;
    // We know we don't care about this author
    if (resolvedDids[author] === false) {
      operationsSkipped++;
      continue;
    }
    // We don't know if we care about this author
    if (resolvedDids[author] === undefined) {
      didsToResolve.add(author);
    }
    if (op.op === 'create') {
      posts[op.uri] = op;
      operationCount++;
      postsAndRepostsProcessed++;
    } else if (op.op === 'delete') {
      deletesProcessed++;
      if (posts[op.uri] != null) {
        delete posts[op.uri];
        operationCount--;
      } else {
        deletes.add(op);
        operationCount++;
      }
    }
    if (didsToResolve.size >= 100 || operationCount >= 1000) {
      const metrics = await processBatch(
        resolvedDids,
        Array.from(didsToResolve),
        Object.values(posts),
        Array.from(deletes)
      );
      postsSaved += metrics.postsSaved;
      repostsSaved += metrics.repostsSaved;
      deletesApplied += metrics.deletesApplied;
      posts = {};
      deletes = new Set();
      operationCount = 0;
      didsToResolve.clear();
    }
  }
  if (operationCount > 0) {
    const metrics = await processBatch(
      resolvedDids,
      Array.from(didsToResolve),
      Object.values(posts),
      Array.from(deletes)
    );
    postsSaved += metrics.postsSaved;
    repostsSaved += metrics.repostsSaved;
    deletesApplied += metrics.deletesApplied;
  }
  console.log(
    `Metrics ${JSON.stringify({
      operationsSkipped,
      postsAndRepostsProcessed,
      deletesProcessed,
      postsSaved,
      repostsSaved,
      deletesApplied,
      start: start.toISOString(),
      syncTimeMs: Date.now() - start.getTime(),
    })}`
  );
};
