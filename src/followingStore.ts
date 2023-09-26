import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb'; // ES6 import
import { FollowingEntry, FollowingRecord } from './types';

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

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

type AggregateFollowingRecord = Omit<FollowingRecord, 'rev' | 'following'> & {
  following: Record<string, number>;
};

export const getAggregateFollowingRecord =
  async (): Promise<AggregateFollowingRecord> => {
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: process.env.SUBSCRIBER_FOLLOWING_TABLE as string,
        Key: {
          subscriberDid: 'aggregate',
          qualifier: 'aggregate',
        },
      })
    );

    return result.Item as AggregateFollowingRecord;
  };

export type FollowingUpdate = {
  operation: 'add' | 'remove';
  following: FollowingEntry;
};

export const saveUpdates = async (
  subscriberFollowing: FollowingRecord,
  operations: Array<FollowingUpdate>
) => {
  const TableName = process.env.SUBSCRIBER_FOLLOWING_TABLE as string;
  let remainingOperations = operations;
  let updatedSubscriberFollowing = subscriberFollowing;
  while (remainingOperations.length > 0) {
    const batch = remainingOperations.slice(0, 100);
    remainingOperations = remainingOperations.slice(100);

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

    const UpdateExpression =
      'ADD ' +
      batch
        .map(
          (operation, i) =>
            `following.#did${i} ${
              operation.operation === 'add' ? ':one' : ':negOne'
            }`
        )
        .join(', ');
    const ExpressionAttributeNames: Record<string, string> = Object.fromEntries(
      batch.map((operation, i) => [`#did${i}`, operation.following.did])
    );
    const ExpressionAttributeValues: Record<string, number> =
      Object.fromEntries(
        batch.map((operation) =>
          operation.operation === 'add' ? [':one', 1] : [':negOne', -1]
        )
      );

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
        {
          Update: {
            TableName,
            Key: {
              subscriberDid: 'aggregate',
              qualifier: 'aggregate',
            },
            UpdateExpression,
            ExpressionAttributeNames,
            ExpressionAttributeValues,
          },
        },
      ],
    };
    try {
      await ddbDocClient.send(new TransactWriteCommand(writeCommand));
    } catch (e) {
      console.log(JSON.stringify(e, undefined, 2));
    }
  }
};
