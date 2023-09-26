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
                  UpdateExpression: 'SET handle = :handle ADD following :one',
                  ExpressionAttributeValues: {
                    ':one': 1,
                    ':handle': operation.following.handle,
                  },
                }
              : {
                  UpdateExpression: 'ADD following :negOne',
                  ExpressionAttributeValues: {
                    ':negOne': -1,
                  },
                }),
          },
        })),
      ],
    };
    try {
      await ddbDocClient.send(new TransactWriteCommand(writeCommand));
    } catch (e) {
      console.log(JSON.stringify(e, undefined, 2));
    }
  }
};
