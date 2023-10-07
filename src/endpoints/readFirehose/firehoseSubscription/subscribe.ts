/*
 * LICENSE NOTE
 * This file and the contents of this folder are largely derived from
 * https://github.com/bluesky-social/feed-generator/blob/f4b815926432bedaf66a7da99b6c8eb65144f2c6/src/util/subscription.ts
 * and associated files. They should be considered a derivative work from the bluesky feed generator.
 * See associated LICENSE file in this folder
 */
import { agent } from '../../../bluesky';
import { BlobRef, ComAtprotoSyncSubscribeRepos } from '@atproto/api';
import type { ClientOptions } from 'ws';
import type { Commit } from '@atproto/api/dist/client/types/com/atproto/sync/subscribeRepos';
import type { Record as PostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import type { Record as RepostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/repost';
import type { Record as LikeRecord } from '@atproto/api/dist/client/types/app/bsky/feed/like';
import type { Record as FollowRecord } from '@atproto/api/dist/client/types/app/bsky/graph/follow';
import { cborToLexRecord, readCar } from '@atproto/repo';
import { Subscription } from '@atproto/xrpc-server';

export type RepoEvent = Commit | { $type: string; [k: string]: unknown };
const lex = agent.api.xrpc.baseClient.lex;

export const isPost = (obj: unknown): obj is PostRecord => {
  return isType(obj, 'app.bsky.feed.post');
};

export const isRepost = (obj: unknown): obj is RepostRecord => {
  return isType(obj, 'app.bsky.feed.repost');
};

export const isLike = (obj: unknown): obj is LikeRecord => {
  return isType(obj, 'app.bsky.feed.like');
};

export const isFollow = (obj: unknown): obj is FollowRecord => {
  return isType(obj, 'app.bsky.graph.follow');
};

const isType = (obj: unknown, nsid: string) => {
  try {
    lex.assertValidRecord(nsid, fixBlobRefs(obj));
    return true;
  } catch (err) {
    return false;
  }
};

// @TODO right now record validation fails on BlobRefs
// simply because multiple packages have their own copy
// of the BlobRef class, causing instanceof checks to fail.
// This is a temporary solution.
const fixBlobRefs = (obj: unknown): unknown => {
  if (Array.isArray(obj)) {
    return obj.map(fixBlobRefs);
  }
  if (obj && typeof obj === 'object') {
    if (obj.constructor.name === 'BlobRef') {
      const blob = obj as BlobRef;
      return new BlobRef(blob.ref, blob.mimeType, blob.size, blob.original);
    }
    return Object.entries(obj).reduce(
      (acc, [key, val]) => {
        return Object.assign(acc, { [key]: fixBlobRefs(val) });
      },
      {} as Record<string, unknown>
    );
  }
  return obj;
};

export type OperationsByType = {
  posts: Operations<PostRecord>;
  reposts: Operations<RepostRecord>;
  likes: Operations<LikeRecord>;
  follows: Operations<FollowRecord>;
};

export type Operations<T = Record<string, unknown>> = {
  creates: CreateOp<T>[];
  deletes: DeleteOp[];
};

export type CreateOp<T> = {
  op: 'create';
  type: string;
  uri: string;
  cid: string;
  author: string;
  record: T;
};

export type DeleteOp = {
  op: 'delete';
  uri: string;
  author: string;
};

export const ids = {
  ComAtprotoSyncSubscribeRepos: 'com.atproto.sync.subscribeRepos',
  AppBskyFeedPost: 'app.bsky.feed.post',
  AppBskyFeedRepost: 'app.bsky.feed.repost',
  AppBskyFeedLike: 'app.bsky.feed.like',
  AppBskyGraphFollow: 'app.bsky.graph.follow',
};

export class OperationsSubscription
  implements AsyncIterable<OperationsByType & { seq: number; time: string }>
{
  private readonly sub: Subscription;
  constructor(opts: ClientOptions & { cursor?: number; signal?: AbortSignal }) {
    const { cursor, ...otherOpts } = opts;
    this.sub = new Subscription({
      ...otherOpts,
      service: 'wss://bsky.social',
      method: ids.ComAtprotoSyncSubscribeRepos,
      getParams:
        cursor == null
          ? undefined
          : () => ({
              cursor,
            }),
      validate: (value: unknown) => {
        try {
          return lex.assertValidXrpcMessage<RepoEvent>(
            ids.ComAtprotoSyncSubscribeRepos,
            value
          );
        } catch (err) {
          console.error('repo subscription skipped invalid message', err);
        }
      },
    });
  }

  async *[Symbol.asyncIterator]() {
    for await (const evt of this.sub) {
      if (!ComAtprotoSyncSubscribeRepos.isCommit(evt)) continue;
      const ops = await getOpsByType(evt);
      yield { ...ops, seq: evt.seq, time: evt.time };
    }
  }
}

const getOpsByType = async (evt: Commit): Promise<OperationsByType> => {
  const car = await readCar(evt.blocks);
  const opsByType: OperationsByType = {
    posts: { creates: [], deletes: [] },
    reposts: { creates: [], deletes: [] },
    likes: { creates: [], deletes: [] },
    follows: { creates: [], deletes: [] },
  };

  for (const op of evt.ops) {
    const uri = `at://${evt.repo}/${op.path}`;
    const [collection] = op.path.split('/');

    if (op.action === 'update') continue; // updates not supported yet

    if (op.action === 'create') {
      if (!op.cid) continue;
      const recordBytes = car.blocks.get(op.cid);
      const create: Omit<CreateOp<unknown>, 'record'> = {
        op: 'create',
        type: collection,
        uri,
        cid: op.cid.toString(),
        author: evt.repo,
      };
      if (!recordBytes) continue;
      const record = cborToLexRecord(recordBytes);
      if (collection === ids.AppBskyFeedPost && isPost(record)) {
        opsByType.posts.creates.push({ record, ...create });
      } else if (collection === ids.AppBskyFeedRepost && isRepost(record)) {
        opsByType.reposts.creates.push({ record, ...create });
      } else if (collection === ids.AppBskyFeedLike && isLike(record)) {
        opsByType.likes.creates.push({ record, ...create });
      } else if (collection === ids.AppBskyGraphFollow && isFollow(record)) {
        opsByType.follows.creates.push({ record, ...create });
      }
    }

    if (op.action === 'delete') {
      if (collection === ids.AppBskyFeedPost) {
        opsByType.posts.deletes.push({ op: 'delete', uri, author: evt.repo });
      } else if (collection === ids.AppBskyFeedRepost) {
        opsByType.reposts.deletes.push({ op: 'delete', uri, author: evt.repo });
      } else if (collection === ids.AppBskyFeedLike) {
        opsByType.likes.deletes.push({ op: 'delete', uri, author: evt.repo });
      } else if (collection === ids.AppBskyGraphFollow) {
        opsByType.follows.deletes.push({ op: 'delete', uri, author: evt.repo });
      }
    }
  }

  return opsByType;
};
