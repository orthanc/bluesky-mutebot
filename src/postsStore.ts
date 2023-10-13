import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  BatchWriteCommandOutput,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb'; // ES6 import
import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 3 });

export type PostTableRecord = {
  uri: string;
  createdAt: string;
  author: string;
  resolvedStatus?: 'UNRESOLVED' | 'EXTERNAL_RESOLVE' | 'RESOLVED'; // NOT USED ANY MORE BUT STILL PRESENT IN SOME DATA
  expiresAt: number;
} & (
  | {
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
      startsWithMention?: true;
      mentionedDids: Array<string>;
      textEntries: Array<string>;
    }
  | { type: 'repost'; repostedPostUri: string }
);

export type FeedEntry = Pick<
  PostTableRecord,
  'uri' | 'author' | 'createdAt' | 'expiresAt'
> &
  ({ type: 'post' } | { type: 'repost'; repostedPostUri: string });

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

export const getPostsForExternalResolve = async (
  limit: number
): Promise<Array<PostTableRecord>> => {
  const TableName = process.env.POSTS_TABLE as string;
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName,
      IndexName: 'ByResolvedStatusAndCreatedAt',
      KeyConditionExpression: 'resolvedStatus = :externalResolve',
      ExpressionAttributeValues: {
        ':externalResolve': 'EXTERNAL_RESOLVE',
      },
      Limit: limit,
    })
  );
  return (result.Items ?? []) as Array<PostTableRecord>;
};

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

export const savePost = async (post: PostTableRecord) => {
  const TableName = process.env.POSTS_TABLE as string;
  await ddbDocClient.send(
    new PutCommand({
      TableName,
      Item: post,
    })
  );
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

const postToFeedEntry = (
  subscriberDid: string,
  post: FeedEntry
): { subscriberDid: string } & FeedEntry => ({
  subscriberDid,
  uri: post.uri,
  author: post.author,
  createdAt: post.createdAt,
  expiresAt: post.expiresAt,
  ...(post.type === 'repost'
    ? { type: 'repost', repostedPostUri: post.repostedPostUri }
    : { type: 'post' }),
});

export const addToFeeds = async (
  post: PostTableRecord,
  followedBy: Array<string>
) => {
  const TableName = process.env.FEED_TABLE as string;
  let operations = followedBy.map(
    (subscriberDid): { PutRequest: { Item: Record<string, unknown> } } => ({
      PutRequest: {
        Item: postToFeedEntry(subscriberDid, post),
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
  console.log(`Saved ${post.uri} to ${followedBy.length} feeds`);
};

export const removeFromFeeds = async (postUri: string) => {
  const TableName = process.env.FEED_TABLE as string;

  const feedsToRemoveFrom: Array<string> = [];
  let cursor: Record<string, unknown> | undefined = undefined;
  do {
    const records: QueryCommandOutput = await ddbDocClient.send(
      new QueryCommand({
        TableName,
        IndexName: 'ByPostUri',
        KeyConditionExpression: 'uri = :postUri',
        ExpressionAttributeValues: {
          ':postUri': postUri,
        },
        ExclusiveStartKey: cursor,
      })
    );
    cursor = records.LastEvaluatedKey;
    (records.Items ?? []).forEach((item) =>
      feedsToRemoveFrom.push(item.subscriberDid)
    );
  } while (cursor != null);

  let operations = feedsToRemoveFrom.map(
    (subscriberDid): { DeleteRequest: { Key: Record<string, unknown> } } => ({
      DeleteRequest: {
        Key: {
          subscriberDid,
          uri: postUri,
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
  console.log(`Deleted ${postUri} to ${feedsToRemoveFrom.length} feeds`);
};

export const removeAuthorFromFeed = async (
  subscriberDid: string,
  author: string
) => {
  const TableName = process.env.FEED_TABLE as string;

  const postUrisToRemove: Array<string> = [];
  let cursor: Record<string, unknown> | undefined = undefined;
  do {
    const records: QueryCommandOutput = await ddbDocClient.send(
      new QueryCommand({
        TableName,
        IndexName: 'ByAuthor',
        KeyConditionExpression:
          'subscriberDid = :subscriberDid AND author = :author',
        ExpressionAttributeValues: {
          ':subscriberDid': subscriberDid,
          ':author': author,
        },
        ExclusiveStartKey: cursor,
      })
    );
    cursor = records.LastEvaluatedKey;
    (records.Items ?? []).forEach((item) => postUrisToRemove.push(item.uri));
  } while (cursor != null);

  let operations = postUrisToRemove.map(
    (uri): { DeleteRequest: { Key: Record<string, unknown> } } => ({
      DeleteRequest: {
        Key: {
          subscriberDid,
          uri,
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
  console.log(
    `Deleted ${postUrisToRemove.length} by ${author} from ${subscriberDid}`
  );
};

export const addAuthorToFeed = async (
  subscriberDid: string,
  author: string
) => {
  const PostsTableName = process.env.POSTS_TABLE as string;
  const TableName = process.env.FEED_TABLE as string;

  const records: QueryCommandOutput = await ddbDocClient.send(
    new QueryCommand({
      TableName: PostsTableName,
      IndexName: 'ByAuthorV2',
      KeyConditionExpression: 'author = :author',
      ExpressionAttributeValues: {
        ':author': author,
      },
      Limit: 100,
    })
  );
  const postsToAdd = (records.Items ?? []) as Array<FeedEntry>;
  let operations = postsToAdd.map(
    (post): { PutRequest: { Item: Record<string, unknown> } } => ({
      PutRequest: {
        Item: postToFeedEntry(subscriberDid, post),
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
  console.log(`Added ${postsToAdd.length} by ${author} from ${subscriberDid}`);
};

export const listFeed = async (
  subscriberDid: string,
  limit: number,
  cursor: string | undefined
): Promise<{ cursor?: string; posts: Array<FeedEntry> }> => {
  const TableName = process.env.FEED_TABLE as string;

  const records: QueryCommandOutput = await ddbDocClient.send(
    new QueryCommand({
      TableName: TableName,
      IndexName: 'ByCreatedAt',
      KeyConditionExpression: 'subscriberDid = :subscriberDid',
      ExpressionAttributeValues: {
        ':subscriberDid': subscriberDid,
      },
      ScanIndexForward: false,
      ExclusiveStartKey: cursor == null ? undefined : JSON.parse(atob(cursor)),
      Limit: limit,
    })
  );

  return {
    cursor:
      records.LastEvaluatedKey == null
        ? undefined
        : btoa(JSON.stringify(records.LastEvaluatedKey)),
    posts: (records.Items ?? []) as Array<FeedEntry>,
  };
};
