import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  ScanCommandOutput,
  TransactWriteCommand,
  TransactWriteCommandInput,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'; // ES6 import
import {
  FollowingEntry,
  FollowingSet,
  SyncSubscriberQueueRecord,
} from './types';

export type FollowingRecord = {
  subscriberDid: string;
  qualifier: 'subscriber' | string;
  following: FollowingSet;
  selfRecorded?: true;
  rev: number;
};

export type FollowingUpdate = {
  operation: 'add' | 'remove' | 'self' | 'remove-self';
  following: FollowingEntry;
};

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

const subscriberFollowingTableName = process.env
  .SUBSCRIBER_FOLLOWING_TABLE as string;
const followedByCountTableName = process.env.FOLLOWED_BY_COUNT_TABLE as string;

export async function* listSubscriberSyncBefore(
  beforeDate: string
): AsyncGenerator<SyncSubscriberQueueRecord> {
  const TableName = process.env.SYNC_SUBSCRIBER_QUEUE_TABLE as string;
  let cursor: Record<string, unknown> | undefined = undefined;
  do {
    const response: ScanCommandOutput = await ddbDocClient.send(
      new ScanCommand({
        TableName,
        ExclusiveStartKey: cursor,
        FilterExpression:
          'lastTriggered < :beforeDate AND attribute_not_exists(clear)',
        ExpressionAttributeValues: {
          ':beforeDate': beforeDate,
        },
      })
    );
    cursor = response.LastEvaluatedKey;
    for (const item of response.Items ?? []) {
      yield item as SyncSubscriberQueueRecord;
    }
  } while (cursor != null);
}

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
    console.log('ignoring trigger for ' + subscriberDid + ' not been 30 min');
  }
};

export const triggerClearSubscriber = async ({
  subscriberDid,
  lastTriggered,
}: Pick<SyncSubscriberQueueRecord, 'subscriberDid' | 'lastTriggered'>) => {
  try {
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: process.env.SYNC_SUBSCRIBER_QUEUE_TABLE as string,
        Key: {
          subscriberDid,
        },
        UpdateExpression: 'SET clear = :true, expiresAt = :expiresAt',
        ConditionExpression: 'lastTriggered = :lastTriggered',
        ExpressionAttributeValues: {
          ':true': true,
          ':lastTriggered': lastTriggered,
          ':expiresAt': Math.floor(Date.now() / 1000) + 24 * 3600,
        },
      })
    );
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) {
      throw error;
    }
    console.log(
      'ignoring clear for ' + subscriberDid + ' as last triggered has changed'
    );
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

const didPrefixLength = 'did:plc:'.length + 2;
export const getDidPrefix = (did: string) => did.substring(0, didPrefixLength);

export const saveUpdates = async (
  subscriberFollowing: FollowingRecord,
  operations: Array<FollowingUpdate>
) => {
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
        updatedSubscriberFollowing.following[did] = {
          ...entry,
          linkSaved: true,
        };
      } else if (operation === 'remove') {
        delete updatedSubscriberFollowing.following[did];
      } else if (operation === 'self') {
        updatedSubscriberFollowing.selfRecorded = true;
      } else if (operation === 'remove-self') {
        delete updatedSubscriberFollowing['selfRecorded'];
      }
    }
    const commandItems: TransactWriteCommandInput['TransactItems'] = [];
    if (
      Object.keys(updatedSubscriberFollowing.following).length > 0 ||
      updatedSubscriberFollowing.selfRecorded
    ) {
      commandItems.push({
        Put: {
          TableName: subscriberFollowingTableName,
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
      });
    } else {
      commandItems.push({
        Delete: {
          TableName: subscriberFollowingTableName,
          Key: {
            subscriberDid: updatedSubscriberFollowing.subscriberDid,
            qualifier: updatedSubscriberFollowing.qualifier,
          },
          ConditionExpression: 'rev = :rev',
          ExpressionAttributeValues: { ':rev': lastRev },
        },
      });
    }
    const addedFollowed: Record<string, Set<string>> = {};
    const removedFollowed: Record<string, Set<string>> = {};
    batch.forEach((operation) => {
      if (operation.operation === 'add' || operation.operation === 'self') {
        const didPrefix = getDidPrefix(operation.following.did);
        addedFollowed[didPrefix] = addedFollowed[didPrefix] ?? new Set();
        addedFollowed[didPrefix].add(operation.following.did);
      } else if (
        operation.operation === 'remove' ||
        operation.operation === 'remove-self'
      ) {
        const didPrefix = getDidPrefix(operation.following.did);
        removedFollowed[didPrefix] = removedFollowed[didPrefix] ?? new Set();
        removedFollowed[didPrefix].add(operation.following.did);
      }
    });
    Object.entries(addedFollowed).forEach(([didPrefix, following]) => {
      const followingArray = Array.from(following);
      commandItems.push({
        Update: {
          TableName: followedByCountTableName,
          Key: {
            didPrefix,
          },
          UpdateExpression:
            'SET ' +
            followingArray.map((_, index) => `#d${index} = :true`).join(', '),
          ExpressionAttributeNames: Object.fromEntries(
            followingArray.map((following, index) => [
              `#d${index}`,
              `${following}__${subscriberFollowing.subscriberDid}`,
            ])
          ),
          ExpressionAttributeValues: {
            ':true': true,
          },
        },
      });
    });
    Object.entries(removedFollowed).forEach(([didPrefix, following]) => {
      const followingArray = Array.from(following);
      commandItems.push({
        Update: {
          TableName: followedByCountTableName,
          Key: {
            didPrefix,
          },
          UpdateExpression:
            'REMOVE ' +
            followingArray.map((_, index) => `#d${index}`).join(', '),
          ExpressionAttributeNames: Object.fromEntries(
            followingArray.map((following, index) => [
              `#d${index}`,
              `${following}__${subscriberFollowing.subscriberDid}`,
            ])
          ),
        },
      });
    });

    const writeCommand: TransactWriteCommandInput = {
      TransactItems: commandItems,
    };
    await ddbDocClient.send(new TransactWriteCommand(writeCommand));
  }
};

export const batchGetFollowedByCountRecords = async (
  didPrefixes: ReadonlyArray<string>
): Promise<Record<string, Record<string, true>>> => {
  const TableName = process.env.FOLLOWED_BY_COUNT_TABLE as string;

  let keys: Array<Record<string, unknown>> = didPrefixes.map((didPrefix) => ({
    didPrefix,
  }));
  const records: Record<string, Record<string, true>> = {};
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
      (item) => (records[item.didPrefix] = item as Record<string, true>)
    );
  }
  return records;
};
