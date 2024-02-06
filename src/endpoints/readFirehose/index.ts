/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Context } from 'aws-lambda';
import { listPostChanges } from './listPostChanges';
import { CreateOp, DeleteOp, ids } from './firehoseSubscription/subscribe';
import type { Record as PostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import type { Record as RepostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/repost';
import {
  AggregateListRecord,
  batchGetAggregateListRecord,
  batchGetFollowedByCountRecords,
  getDidPrefix,
} from '../../followingStore';
import {
  POST_RETENTION_SECONDS,
  PostTableRecord,
  savePostsBatch,
} from '../../postsStore';
import { postToPostTableRecord } from './postToPostTableRecord';

interface FollowedByFinder {
  uniqueResolves: () => number;
  shouldResolveDids: () => boolean;
  resolveDids: () => Promise<void>;
  didEncountered: (authorDid: string) => void;
  isKnownNotFollowed: (authorDid: string) => boolean;
  getFollowedBy: (authorDid: string) => Record<string, true> | undefined;
}

class AggregateFollowedByFinder {
  private readonly resolvedDids: Record<string, AggregateListRecord | false> =
    {};
  private readonly didsToResolve: Set<string> = new Set();
  private readonly followedBy: Record<string, Record<string, true> | false> =
    {};

  uniqueResolves() {
    return Object.keys(this.resolvedDids).length;
  }

  shouldResolveDids(): boolean {
    return this.didsToResolve.size >= 100;
  }

  async resolveDids() {
    const didsToResolve = Array.from(this.didsToResolve);
    this.didsToResolve.clear();
    const newlyResolvedDids = await batchGetAggregateListRecord(didsToResolve);
    didsToResolve.forEach(
      (did) => (this.resolvedDids[did] = newlyResolvedDids[did] ?? false)
    );
  }

  didEncountered(authorDid: string) {
    if (this.resolvedDids[authorDid] === undefined) {
      this.didsToResolve.add(authorDid);
    }
  }

  isKnownNotFollowed(authorDid: string): boolean {
    return this.resolvedDids[authorDid] === false;
  }

  getFollowedBy(authorDid: string): Record<string, true> | undefined {
    let followedBy = this.followedBy[authorDid];
    if (followedBy === false) return undefined;
    if (followedBy != null) return followedBy;
    const followedByRecord = this.resolvedDids[authorDid];
    if (followedByRecord == null) return undefined;
    if (followedByRecord && followedByRecord.followedBy > 0) {
      const followedByEntries = Object.entries(followedByRecord)
        .filter(([key]) => key.startsWith('followedBy_'))
        .map(([key]): [string, true] => [key.substring(11), true]);
      if (followedByEntries.length > 0) {
        followedBy = Object.fromEntries(followedByEntries);
      }
    }
    this.followedBy[authorDid] = followedBy ?? false;

    return followedBy;
  }
}

class FollowedByCountFollowedByFinder {
  private readonly followedByCountRecords: Record<
    string,
    Record<string, true> | false
  > = {};
  private readonly didPrefixesToResolve: Set<string> = new Set();
  private readonly followedBy: Record<string, Record<string, true> | false> =
    {};

  uniqueResolves() {
    return Object.keys(this.followedByCountRecords).length;
  }

  shouldResolveDids(): boolean {
    return this.didPrefixesToResolve.size >= 100;
  }

  async resolveDids() {
    const didPrefixesToResolve = Array.from(this.didPrefixesToResolve);
    this.didPrefixesToResolve.clear();
    const newFollowedByCountRecords =
      await batchGetFollowedByCountRecords(didPrefixesToResolve);
    didPrefixesToResolve.forEach(
      (didPrefix) =>
        (this.followedByCountRecords[didPrefix] =
          newFollowedByCountRecords[didPrefix] ?? false)
    );
  }

  didEncountered(authorDid: string) {
    const didPrefix = getDidPrefix(authorDid);
    if (this.followedByCountRecords[didPrefix] === undefined) {
      this.didPrefixesToResolve.add(didPrefix);
    }
  }

  isKnownNotFollowed(authorDid: string): boolean {
    const didPrefix = getDidPrefix(authorDid);
    if (this.followedByCountRecords[didPrefix] == null) return false;
    return this.getFollowedBy(authorDid) == null;
  }

  getFollowedBy(authorDid: string): Record<string, true> | undefined {
    let followedBy = this.followedBy[authorDid];
    if (followedBy === false) return undefined;
    if (followedBy != null) return followedBy;

    const didPrefix = getDidPrefix(authorDid);
    const followedByCountRecord = this.followedByCountRecords[didPrefix];
    if (followedByCountRecord == null) return undefined;
    if (followedByCountRecord !== false) {
      const followedByPrefix = `${authorDid}__`;
      const followedByEntries = Object.entries(followedByCountRecord)
        .filter(([key]) => key.startsWith(followedByPrefix))
        .map(([key]): [string, true] => [
          key.substring(followedByPrefix.length),
          true,
        ]);
      if (followedByEntries.length > 0) {
        followedBy = Object.fromEntries(followedByEntries);
      }
    }
    this.followedBy[authorDid] = followedBy ?? false;

    return followedBy;
  }
}

const processBatch = async (
  followByFinder: FollowedByFinder,
  posts: ReadonlyArray<CreateOp<PostRecord | RepostRecord>>,
  deletes: ReadonlyArray<DeleteOp>
) => {
  const expiresAt = Math.floor(Date.now() / 1000) + POST_RETENTION_SECONDS;
  await followByFinder.resolveDids();

  let postsSaved = 0;
  let repostsSaved = 0;
  const postsToSave = posts.flatMap((post): Array<PostTableRecord> => {
    const followedBy = followByFinder.getFollowedBy(post.author);
    if (followedBy == null) return [];
    if (post.type === ids.AppBskyFeedRepost && post.record.subject != null) {
      repostsSaved++;
      return [
        {
          uri: post.uri,
          createdAt: post.record.createdAt,
          author: post.author,
          type: 'repost',
          resolvedStatus: 'RESOLVED',
          // resolvedStatus: 'UNRESOLVED',
          expiresAt,
          // @ts-expect-error
          repostedPostUri: post.record.subject.uri,
          followedBy,
        },
      ];
    } else if (post.type === ids.AppBskyFeedPost) {
      postsSaved++;
      return [
        postToPostTableRecord(
          post as CreateOp<PostRecord>,
          expiresAt,
          followedBy
        ),
      ];
    }
    return [];
  });
  const deletesToApply = deletes
    .filter(({ author }) => followByFinder.getFollowedBy(author) != null)
    .map((del) => del.uri);
  const notDeletedPostsToSave = postsToSave.filter(
    (post) => !deletesToApply.includes(post.uri)
  );
  await savePostsBatch(notDeletedPostsToSave, deletesToApply);
  return {
    metrics: {
      postsSaved,
      repostsSaved,
      deletesApplied: deletesToApply.length,
    },
    savedPosts: notDeletedPostsToSave,
  };
};

export const handler = async (_: unknown, context: Context): Promise<void> => {
  const maxReadTimeMillis = Math.floor(
    context.getRemainingTimeInMillis() * 0.8
  );

  console.log({ maxReadTimeMillis });

  // const followedByFinder = new AggregateFollowedByFinder();
  const followedByFinder = new FollowedByCountFollowedByFinder();

  let operationCount = 0;
  let posts: Record<string, CreateOp<PostRecord | RepostRecord>> = {};
  const allSavedPosts: Array<PostTableRecord> = [];
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
    if (followedByFinder.isKnownNotFollowed(author)) {
      operationsSkipped++;
      continue;
    }
    followedByFinder.didEncountered(author);
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
    if (followedByFinder.shouldResolveDids() || operationCount >= 1000) {
      const { metrics, savedPosts } = await processBatch(
        followedByFinder,
        Object.values(posts),
        Array.from(deletes)
      );
      postsSaved += metrics.postsSaved;
      repostsSaved += metrics.repostsSaved;
      deletesApplied += metrics.deletesApplied;
      posts = {};
      deletes = new Set();
      operationCount = 0;
      allSavedPosts.push(...savedPosts);
    }
  }
  if (operationCount > 0) {
    const { metrics, savedPosts } = await processBatch(
      followedByFinder,
      Object.values(posts),
      Array.from(deletes)
    );
    postsSaved += metrics.postsSaved;
    repostsSaved += metrics.repostsSaved;
    deletesApplied += metrics.deletesApplied;
    allSavedPosts.push(...savedPosts);
  }

  const postsByFollowedBy = allSavedPosts.reduce<
    Record<string, Array<PostTableRecord>>
  >((acc, { followedBy, ...post }) => {
    if (followedBy != null) {
      Object.keys(followedBy).forEach((follower) => {
        const posts = acc[follower] ?? [];
        acc[follower] = posts;
        posts.push(post);
      });
    }
    return acc;
  }, {});
  console.log({
    totalSavedPosts: allSavedPosts.length,
    distinctSubscribers: Object.keys(postsByFollowedBy).length,
    totalFollowedSize: JSON.stringify(postsByFollowedBy).length,
  });

  // await Promise.all(
  //   Object.entries(allPostsByFollowedBy).map(async ([subscriberDid, posts]) =>
  //     saveToUserFeed(subscriberDid, posts)
  //   )
  // );
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
      uniqueResolves: followedByFinder.uniqueResolves(),
    })}`
  );
};
