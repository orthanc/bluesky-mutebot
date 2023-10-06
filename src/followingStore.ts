import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  TransactWriteCommandInput,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'; // ES6 import
import { FollowingEntry, FollowingSet } from './types';

export type FollowingRecord = {
  subscriberDid: string;
  qualifier: 'subscriber' | 'aggregate';
  following: FollowingSet;
  rev: number;
};

export type FollowingUpdate = {
  operation: 'add' | 'remove';
  following: FollowingEntry;
};

export type AggregateListRecord = {
  subscriberDid: 'aggregate';
  qualifier: string;
  handle: string;
  followedBy: number;
  followingEntryUri?: string;
  followingEntryRid?: string;
};

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

export const triggerSubscriberSync = async (subscriberDid: string) => {
  try {
    const now = new Date().toISOString();
    await ddbDocClient.send(
      new PutCommand({
        TableName: process.env.SYNC_SUBSCRIBER_QUEUE_TABLE as string,
        Item: {
          subscriberDid,
          lastTriggered: now,
        },
        ConditionExpression:
          'attribute_not_exists(lastTriggered) OR lastTriggered < :lastTriggeredCheck',
        ExpressionAttributeValues: {
          ':lastTriggeredCheck': new Date(
            Date.now() - 30 * 60000
          ).toISOString(),
        },
      })
    );
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) {
      throw error;
    }
    console.log('ignoring trugger for ' + subscriberDid + ' not been 30 min');
  }
};

export const getSubscriberFollowingRecord = async (
  subscriberDid: string
): Promise<FollowingRecord> => {
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: process.env.SUBSCRIBER_FOLLOWING_TABLE as string,
      Key: {
        subscriberDid,
        qualifier: 'subscriber',
      },
    })
  );

  const record = result.Item as FollowingRecord | undefined;
  return (
    record ?? {
      subscriberDid,
      qualifier: 'subscriber',
      following: {},
      rev: 0,
    }
  );
};

export const saveUpdates = async (
  subscriberFollowing: FollowingRecord,
  operations: Array<FollowingUpdate>
) => {
  const TableName = process.env.SUBSCRIBER_FOLLOWING_TABLE as string;
  let remainingOperations = operations;
  let updatedSubscriberFollowing = subscriberFollowing;
  while (remainingOperations.length > 0) {
    const batch = remainingOperations.slice(0, 99);
    remainingOperations = remainingOperations.slice(99);

    const lastRev = updatedSubscriberFollowing.rev;
    updatedSubscriberFollowing = {
      ...updatedSubscriberFollowing,
      following: { ...updatedSubscriberFollowing.following },
      rev: lastRev + 1,
    };
    for (const {
      operation,
      following: { did, ...entry },
    } of batch) {
      if (operation === 'add') {
        updatedSubscriberFollowing.following[did] = entry;
      } else {
        delete updatedSubscriberFollowing.following[did];
      }
    }

    const writeCommand: TransactWriteCommandInput = {
      TransactItems: [
        {
          Put: {
            TableName,
            Item: updatedSubscriberFollowing,
            ...(lastRev === 0
              ? {
                  ConditionExpression: 'attribute_not_exists(subscriberDid)',
                }
              : {
                  ConditionExpression: 'rev = :rev',
                  ExpressionAttributeValues: { ':rev': lastRev },
                }),
          },
        },
        ...batch.map((operation) => ({
          Update: {
            TableName,
            Key: {
              subscriberDid: 'aggregate',
              qualifier: operation.following.did,
            },
            ...(operation.operation === 'add'
              ? {
                  UpdateExpression: 'SET handle = :handle ADD followedBy :one',
                  ExpressionAttributeValues: {
                    ':one': 1,
                    ':handle': operation.following.handle,
                  },
                }
              : {
                  UpdateExpression: 'ADD followedBy :negOne',
                  ExpressionAttributeValues: {
                    ':negOne': -1,
                  },
                }),
          },
        })),
      ],
    };
    await ddbDocClient.send(new TransactWriteCommand(writeCommand));
  }
};

export const getAggregateListRecord = async (
  followingDid: string
): Promise<AggregateListRecord | undefined> => {
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: process.env.SUBSCRIBER_FOLLOWING_TABLE as string,
      Key: {
        subscriberDid: 'aggregate',
        qualifier: followingDid,
      },
    })
  );
  return result.Item as AggregateListRecord | undefined;
};

export const batchGetAggregateListRecord = async (
  userDids: ReadonlyArray<string>
): Promise<Record<string, AggregateListRecord>> => {
  const TableName = process.env.SUBSCRIBER_FOLLOWING_TABLE as string;

  let keys: Array<Record<string, unknown>> = userDids.map((did) => ({
    subscriberDid: 'aggregate',
    qualifier: did,
  }));
  const records: Record<string, AggregateListRecord> = {};
  while (keys.length > 0) {
    const batch = keys.slice(0, 100);
    keys = keys.slice(100);
    const result = await ddbDocClient.send(
      new BatchGetCommand({
        RequestItems: {
          [TableName]: {
            Keys: batch,
          },
        },
      })
    );
    const unprocessedKeys = result.UnprocessedKeys?.[TableName]?.Keys;
    if (unprocessedKeys != null) {
      keys.push(...unprocessedKeys);
    }
    result.Responses?.[TableName]?.forEach(
      (item) => (records[item.qualifier] = item as AggregateListRecord)
    );
  }
  return records;
};

export const recordFollowingEntryId = async (
  followingDid: string,
  followingEntryUri: string,
  followingEntryRid: string
) => {
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: process.env.SUBSCRIBER_FOLLOWING_TABLE as string,
      Key: {
        subscriberDid: 'aggregate',
        qualifier: followingDid,
      },
      UpdateExpression:
        'SET followingEntryUri = :followingEntryUri, followingEntryRid = :followingEntryRid',
      ExpressionAttributeValues: {
        ':followingEntryUri': followingEntryUri,
        ':followingEntryRid': followingEntryRid,
      },
      ConditionExpression: 'attribute_exists(qualifier)',
    })
  );
};

export const deleteAggregateListRecord = async (
  followingDid: string
): Promise<AggregateListRecord> => {
  const result = await ddbDocClient.send(
    new DeleteCommand({
      TableName: process.env.SUBSCRIBER_FOLLOWING_TABLE as string,
      Key: {
        subscriberDid: 'aggregate',
        qualifier: followingDid,
      },
      ConditionExpression: 'followedBy = :zero',
      ExpressionAttributeValues: {
        ':zero': 0,
      },
      ReturnValues: 'ALL_OLD',
    })
  );
  return result.Attributes as AggregateListRecord;
};
