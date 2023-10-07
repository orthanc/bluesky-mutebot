import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  BatchWriteCommandOutput,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb'; // ES6 import
import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 3 });

export type PostEntry = {
  uri: string;
  createdAt: string;
  author: string;
  isReply?: true;
  replyRootUri?: string;
  replyRootAuthorDid?: string;
  replyParentUri?: string;
  replyParentAuthorDid?: string;
  startsWithMention?: true;
  mentionedDids: Array<string>;
  textEntries: Array<string>;
};

export type PostTableRecord = {
  uri: string;
  createdAt: string;
  author: string;
  resolvedStatus: 'UNRESOLVED' | 'RESOLVED';
  expiresAt: number;
} & (
  | ({ type: 'post' } & PostEntry)
  | { type: 'repost'; repostedPostUri: string; post?: PostEntry }
);

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

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
          try {
            console.log(`Saving Batch ${JSON.stringify(batch)}`);
            return await ddbDocClient.send(
              new BatchWriteCommand({
                RequestItems: {
                  [TableName]: batch,
                },
              })
            );
          } catch (e) {
            console.log(JSON.stringify(batch));
            throw e;
          }
        })
      );
    }
    for (const result of await Promise.all(promises)) {
      const unprocessedItems = result.UnprocessedItems?.[TableName];
      if (unprocessedItems != null) {
        console.log(
          `Retrying with unprocessed Items: ${
            operations.length
          } ${JSON.stringify(unprocessedItems)}`
        );
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        operations.push(...unprocessedItems);
      }
    }
  }
  console.log(`Saved ${posts.length} posts and ${deletes.length} deletes`);
};
