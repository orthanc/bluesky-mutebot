import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  BatchWriteCommandOutput,
  DynamoDBDocumentClient,
  QueryCommand,
  QueryCommandInput,
  QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb'; // ES6 import
import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 3 });

export const POST_RETENTION_SECONDS = 24 * 3600;

export type PostEntry = {
  type: 'post';
  uri: string;
  createdAt: string;
  author: string;
  isReply?: true;
  replyRootUri?: string;
  replyRootAuthorDid?: string;
  replyRootTextEntries?: Array<string>;
  replyParentUri?: string;
  replyParentAuthorDid?: string;
  replyParentTextEntries?: Array<string>;
  quotedPostUri?: string;
  quotedPostAuthorDid?: string;
  externalUri?: string;
  startsWithMention?: true;
  mentionedDids: Array<string>;
  textEntries: Array<string>;
};

export type PostTableRecord = {
  uri: string;
  createdAt: string;
  author: string;
  resolvedStatus: 'UNRESOLVED' | 'EXTERNAL_RESOLVE' | 'RESOLVED'; // NOT USED ANY MORE BUT STILL PRESENT IN SOME DATA
  expiresAt: number;
  followedBy?: Record<string, true>;
  externallyResolved?: boolean;
} & (PostEntry | { type: 'repost'; repostedPostUri: string });

export type FeedEntry = Pick<
  PostTableRecord,
  'uri' | 'author' | 'createdAt' | 'expiresAt'
> &
  ({ type: 'post' } | { type: 'repost'; repostedPostUri: string });

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

export const getPosts = async (
  postUris: Array<string>
): Promise<Record<string, PostTableRecord>> => {
  const TableName = process.env.POSTS_TABLE as string;
  const result: Record<string, PostTableRecord> = {};
  let keys: Array<Record<string, unknown>> = postUris.map((uri) => ({
    uri,
  }));
  while (keys.length > 0) {
    const batch = keys.slice(0, 25);
    keys = keys.slice(25);
    const response = await ddbDocClient.send(
      new BatchGetCommand({
        RequestItems: {
          [TableName]: {
            Keys: batch,
          },
        },
      })
    );
    const unprocessedKeys = response.UnprocessedKeys?.[TableName]?.Keys;
    if (unprocessedKeys != null) {
      keys.push(...unprocessedKeys);
    }
    const items = response.Responses?.[TableName];
    if (items != null) {
      items.forEach((item) => {
        result[item.uri] = item as PostTableRecord;
      });
    }
  }
  return result;
};

export const savePostsBatch = async (
  posts: Array<PostTableRecord>,
  deletes: Array<string>
) => {
  const TableName = process.env.POSTS_TABLE as string;
  let operations: Array<
    | { PutRequest: { Item: Record<string, unknown> } }
    | { DeleteRequest: { Key: Record<string, unknown> } }
  > = [
    ...posts.map((post): { PutRequest: { Item: Record<string, unknown> } } => ({
      PutRequest: {
        Item: post,
      },
    })),
    ...deletes.map(
      (uri): { DeleteRequest: { Key: Record<string, unknown> } } => ({
        DeleteRequest: {
          Key: {
            uri,
          },
        },
      })
    ),
  ];
  while (operations.length > 0) {
    const promises: Array<Promise<BatchWriteCommandOutput>> = [];
    while (operations.length > 0) {
      const batch = operations.slice(0, 25);
      operations = operations.slice(25);

      promises.push(
        queue.add(async () => {
          return await ddbDocClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [TableName]: batch,
              },
            })
          );
        })
      );
    }
    for (const result of await Promise.all(promises)) {
      const unprocessedItems = result.UnprocessedItems?.[TableName];
      if (unprocessedItems != null) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        operations.push(...unprocessedItems);
      }
    }
  }
  console.log(`Saved ${posts.length} posts and ${deletes.length} deletes`);
};

export const saveToUserFeed = async (
  newPostsBySubscriber: Record<string, Array<PostTableRecord>>,
  indexedAt: string,
  expiresAt: number
) => {
  const TableName = process.env.USER_FEED_TABLE as string;
  let operations = Object.entries(newPostsBySubscriber).map(
    ([subscriberDid, posts]): {
      PutRequest: { Item: Record<string, unknown> };
    } => ({
      PutRequest: {
        Item: {
          subscriberDid,
          posts,
          indexedAt,
          expiresAt,
        },
      },
    })
  );
  while (operations.length > 0) {
    const promises: Array<Promise<BatchWriteCommandOutput>> = [];
    while (operations.length > 0) {
      const batch = operations.slice(0, 25);
      operations = operations.slice(25);

      promises.push(
        queue.add(async () => {
          return await ddbDocClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [TableName]: batch,
              },
            })
          );
        })
      );
    }
    for (const result of await Promise.all(promises)) {
      const unprocessedItems = result.UnprocessedItems?.[TableName];
      if (unprocessedItems != null) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        operations.push(...unprocessedItems);
      }
    }
  }
};

export const listFeedFromPosts = async (
  subscriberDid: string,
  limit: number,
  cursor: string | undefined
): Promise<{ cursor?: string; posts: Array<PostTableRecord> }> => {
  const TableName = process.env.POSTS_TABLE as string;
  let result: Array<PostTableRecord> = [];
  let requestCursor: Record<string, unknown> | undefined =
    cursor == null ? undefined : JSON.parse(atob(cursor));

  let fetchesRequired = 0;
  let consumedCapacityUnits = 0;
  let requestLimit = limit;
  const minResults = Math.floor(limit * 0.8);
  do {
    fetchesRequired++;
    const response: QueryCommandOutput = await ddbDocClient.send(
      new QueryCommand({
        TableName: TableName,
        IndexName: 'ByResolvedStatusAndCreatedAt',
        KeyConditionExpression: 'resolvedStatus = :resolved',
        FilterExpression: 'followedBy.#subscriberDid = :true',
        ExpressionAttributeNames: {
          '#subscriberDid': subscriberDid,
        },
        ExpressionAttributeValues: {
          ':true': true,
          ':resolved': 'RESOLVED',
        },
        ScanIndexForward: false,
        ExclusiveStartKey: requestCursor,
        /*
         * limit is applied before the filter expression, so if we say limit 30
         * then we might only get one post back which is annoying.
         * So better to limit to some multiple of the number of posts we're expecting.
         *
         * The 15 is kinda arbitrary and just seems good based on testing. Needs further
         * tuning based on watching the number of fetches
         */
        Limit: requestLimit * 15,
        ReturnConsumedCapacity: 'TOTAL',
      })
    );
    requestCursor = response.LastEvaluatedKey;
    consumedCapacityUnits += response.ConsumedCapacity?.CapacityUnits ?? 0;
    (response.Items ?? []).forEach((item) => {
      result.push(item as PostTableRecord);
    });
    requestLimit = limit - result.length;
  } while (
    requestCursor != null &&
    result.length < minResults &&
    fetchesRequired < 5
  );
  console.log({
    fetchesRequired,
    limit,
    foundPosts: result.length,
    consumedCapacityUnits,
  });
  if (result.length > limit) {
    requestCursor = {
      resolvedStatus: result[limit].resolvedStatus,
      createdAt: result[limit].createdAt,
      uri: result[limit].uri,
    };
    result = result.slice(0, limit);
  }

  return {
    cursor:
      requestCursor == null ? undefined : btoa(JSON.stringify(requestCursor)),
    posts: result,
  };
};

export const listFeedFromUserFeedRecord = async (
  subscriberDid: string,
  limit: number,
  startDate: string | undefined,
  startPostUrl: string | undefined
): Promise<{
  posts: Array<{ indexedAt: string; post: PostTableRecord }>;
  cursor?: string;
}> => {
  const TableName = process.env.USER_FEED_TABLE as string;
  let posts: Array<{ indexedAt: string; post: PostTableRecord }> = [];
  let cursor: QueryCommandInput['ExclusiveStartKey'] = undefined;
  do {
    const result: QueryCommandOutput = await ddbDocClient.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression:
          'subscriberDid = :subscriberDid AND indexedAt <= :startDate',
        ExpressionAttributeValues: {
          ':subscriberDid': subscriberDid,
          ':startDate': startDate ?? '9999',
        },
        ScanIndexForward: false,
        Limit: 20,
      })
    );

    cursor = result.LastEvaluatedKey;

    if (result.Items != null) {
      for (const item of result.Items) {
        const recordPosts = (item.posts ?? []) as Array<PostTableRecord>;
        posts.push(
          ...recordPosts.map((post) => ({
            post,
            indexedAt: item.indexedAt as string,
          }))
        );
      }
    }
  } while (cursor != null && posts.length < 3 * limit);

  posts = posts
    .sort((a, b) => {
      if (a.post.createdAt < b.post.createdAt) return 1;
      if (a.post.createdAt > b.post.createdAt) return -1;
      return 0;
    })
    .slice(0, 3 * limit);

  if (startPostUrl != null) {
    const startFrom = posts.findIndex((post) => post.post.uri === startPostUrl);
    if (startFrom === -1) posts = [];
    else posts = posts.slice(startFrom + 1);
  }

  return { posts };
};
