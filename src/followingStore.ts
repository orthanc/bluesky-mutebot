import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
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
  listItemUri?: string;
  listItemRid?: string;
};

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

export const recordListItemId = async (
  followingDid: string,
  listItemUri: string,
  listItemRid: string
) => {
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: process.env.SUBSCRIBER_FOLLOWING_TABLE as string,
      Key: {
        subscriberDid: 'aggregate',
        qualifier: followingDid,
      },
      UpdateExpression:
        'SET listItemUri = :listItemUri, listItemRid = :listItemRid',
      ExpressionAttributeValues: {
        ':listItemUri': listItemUri,
        ':listItemRid': listItemRid,
      },
      ConditionExpression: 'attribute_exists(qualifier)',
    })
  );
};

export const deleteAggregateListRecord = async (followingDid: string) => {
  await ddbDocClient.send(
    new DeleteCommand({
      TableName: process.env.SUBSCRIBER_FOLLOWING_TABLE as string,
      Key: {
        subscriberDid: 'aggregate',
        qualifier: followingDid,
      },
    })
  );
};
