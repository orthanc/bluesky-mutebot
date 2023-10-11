import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DeleteCommandInput,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  PutCommandInput,
  QueryCommand,
  QueryCommandOutput,
  TransactWriteCommand,
  TransactWriteCommandInput,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'; // ES6 import
import { FollowingEntry, FollowingSet } from './types';

export type FollowingRecord = {
  subscriberDid: string;
  qualifier: 'subscriber' | string;
  following: FollowingSet;
  selfRecorded?: true;
  rev: number;
};

export type FollowingUpdate = {
  operation: 'add' | 'remove' | 'self';
  following: FollowingEntry & { onlyLink?: boolean; noLink?: boolean };
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
    const batch = remainingOperations.slice(0, 49);
    remainingOperations = remainingOperations.slice(49);

    const lastRev = updatedSubscriberFollowing.rev;
    updatedSubscriberFollowing = {
      ...updatedSubscriberFollowing,
      following: { ...updatedSubscriberFollowing.following },
      rev: lastRev + 1,
    };
    for (const {
      operation,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      following: { did, onlyLink, noLink, ...entry },
    } of batch) {
      if (operation === 'add') {
        updatedSubscriberFollowing.following[did] = {
          ...entry,
          linkSaved: true,
        };
      } else if (operation === 'remove') {
        delete updatedSubscriberFollowing.following[did];
      } else if (operation === 'self') {
        updatedSubscriberFollowing.selfRecorded = true;
      }
    }

    const subscriberUpdate:
      | { Put: PutCommandInput }
      | { Delete: DeleteCommandInput } =
      Object.keys(updatedSubscriberFollowing.following).length > 0 ||
      updatedSubscriberFollowing.selfRecorded
        ? {
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
          }
        : {
            Delete: {
              TableName,
              Key: {
                subscriberDid: updatedSubscriberFollowing.subscriberDid,
                qualifier: updatedSubscriberFollowing.qualifier,
              },
              ConditionExpression: 'rev = :rev',
              ExpressionAttributeValues: { ':rev': lastRev },
            },
          };
    const writeCommand: TransactWriteCommandInput = {
      TransactItems: [
        subscriberUpdate,
        ...batch.flatMap((operation) => {
          const updates: TransactWriteCommandInput['TransactItems'] = [];
          if (operation.operation === 'add') {
            if (!operation.following.onlyLink) {
              updates.push({
                Update: {
                  TableName,
                  Key: {
                    subscriberDid: 'aggregate',
                    qualifier: operation.following.did,
                  },
                  UpdateExpression:
                    'SET handle = :handle ADD followedBy :one REMOVE expiresAt',
                  ExpressionAttributeValues: {
                    ':one': 1,
                    ':handle': operation.following.handle,
                  },
                },
              });
            }
            updates.push({
              Update: {
                TableName,
                Key: {
                  subscriberDid: operation.following.did,
                  qualifier: subscriberFollowing.subscriberDid,
                },
                UpdateExpression: 'SET following = :one',
                ExpressionAttributeValues: {
                  ':one': 1,
                },
              },
            });
          } else if (operation.operation === 'remove') {
            updates.push({
              Update: {
                TableName,
                Key: {
                  subscriberDid: 'aggregate',
                  qualifier: operation.following.did,
                },
                UpdateExpression: 'ADD followedBy :negOne',
                ExpressionAttributeValues: {
                  ':negOne': -1,
                },
              },
            });
            if (!operation.following.noLink) {
              updates.push({
                Delete: {
                  TableName,
                  Key: {
                    subscriberDid: operation.following.did,
                    qualifier: subscriberFollowing.subscriberDid,
                  },
                },
              });
            }
          } else if (operation.operation === 'self') {
            updates.push(
              {
                Update: {
                  TableName,
                  Key: {
                    subscriberDid: 'aggregate',
                    qualifier: subscriberFollowing.subscriberDid,
                  },
                  UpdateExpression: 'ADD followedBy :one REMOVE expiresAt',
                  ExpressionAttributeValues: {
                    ':one': 1,
                  },
                },
              },
              {
                Update: {
                  TableName,
                  Key: {
                    subscriberDid: subscriberFollowing.subscriberDid,
                    qualifier: subscriberFollowing.subscriberDid,
                  },
                  UpdateExpression: 'SET following = :one',
                  ExpressionAttributeValues: {
                    ':one': 1,
                  },
                },
              }
            );
          }
          return updates;
        }),
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

export const markAggregateListRecordForDeletion = async (
  followingDid: string,
  expiresAt: number
) => {
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: process.env.SUBSCRIBER_FOLLOWING_TABLE as string,
      Key: {
        subscriberDid: 'aggregate',
        qualifier: followingDid,
      },
      UpdateExpression: 'SET expiresAt = :expiresAt',
      ConditionExpression: 'followedBy = :zero',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':expiresAt': expiresAt,
      },
    })
  );
};

export const listFollowedBy = async (authorDid: string) => {
  const result: Array<string> = [];
  let cursor: Record<string, unknown> | undefined = undefined;
  do {
    const records: QueryCommandOutput = await ddbDocClient.send(
      new QueryCommand({
        TableName: process.env.SUBSCRIBER_FOLLOWING_TABLE as string,
        KeyConditionExpression: 'subscriberDid = :authorDid',
        ExpressionAttributeValues: {
          ':authorDid': authorDid,
        },
        ExclusiveStartKey: cursor,
      })
    );
    cursor = records.LastEvaluatedKey;
    (records.Items ?? []).forEach((item) => {
      if (item.qualifier !== 'subscriber') {
        result.push(item.qualifier);
      }
    });
  } while (cursor != null);
  return result;
};
