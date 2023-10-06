import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Context } from 'aws-lambda';
import { listPostChanges } from './listPostChanges';
import { CreateOp, DeleteOp } from './firehoseSubscription/subscribe';
import type { Record as PostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import type { Record as RepostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/repost';
import {
  AggregateListRecord,
  batchGetAggregateListRecord,
} from '../../followingStore';

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

const processBatch = async (
  resolvedDids: Record<string, AggregateListRecord | null>,
  didsToResolve: ReadonlyArray<string>,
  posts: ReadonlyArray<CreateOp<PostRecord | RepostRecord>>,
  deletes: ReadonlyArray<DeleteOp>
) => {
  const newlyResolvedDids = await batchGetAggregateListRecord(didsToResolve);
  didsToResolve.forEach(
    (did) => (resolvedDids[did] = newlyResolvedDids[did] ?? null)
  );
  console.log({
    posts: posts.length,
    deletes: deletes.length,
    didsToResolve: didsToResolve.length,
    resolvedDids: Object.keys(resolvedDids).length,
    interestingDids: Object.values(resolvedDids).filter((val) => val != null)
      .length,
    interstingPosts: posts.filter(
      ({ author }) => (resolvedDids[author]?.followedBy ?? 0) > 0
    ).length,
    interstingDeletes: deletes.filter(
      ({ author }) => resolvedDids[author] != null
    ).length,
  });
};

export const handler = async (_: unknown, context: Context): Promise<void> => {
  const maxReadTimeMillis = Math.floor(
    context.getRemainingTimeInMillis() * 0.8
  );

  console.log({ maxReadTimeMillis });

  const resolvedDids: Record<string, AggregateListRecord | null> = {};
  const didsToResolve = new Set<string>();

  let operationCount = 0;
  let posts: Record<string, CreateOp<PostRecord | RepostRecord>> = {};
  let deletes: Array<DeleteOp> = [];
  for await (const op of listPostChanges({ maxReadTimeMillis })) {
    const { author } = op;
    // We know we don't care about this author
    if (resolvedDids[author] === null) {
      continue;
    }
    // We don't know if we care about this author
    if (resolvedDids[author] === undefined) {
      didsToResolve.add(author);
    }
    if (op.op === 'create') {
      posts[op.uri] = op;
      operationCount++;
    } else if (op.op === 'delete') {
      if (posts[op.uri] != null) {
        delete posts[op.uri];
        operationCount--;
      } else {
        deletes.push(op);
        operationCount++;
      }
    }
    if (didsToResolve.size >= 100 || operationCount >= 1000) {
      await processBatch(
        resolvedDids,
        Array.from(didsToResolve),
        Object.values(posts),
        deletes
      );
      posts = {};
      deletes = [];
      operationCount = 0;
      didsToResolve.clear();
    }
  }
  if (operationCount > 0) {
    await processBatch(
      resolvedDids,
      Array.from(didsToResolve),
      Object.values(posts),
      deletes
    );
  }
};
