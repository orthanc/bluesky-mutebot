import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  QueryCommandOutput,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const USER_SETTINGS_TABLE = process.env.USER_SETTINGS_TABLE as string;

export type MuteWordsOperation = {
  operation: 'mute' | 'unmute';
  subscriberDid: string;
  word: string;
};

export const getMuteWords = async (
  subscriberDid: string
): Promise<Array<string>> => {
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: USER_SETTINGS_TABLE,
      Key: {
        subscriberDid,
      },
    })
  );
  if (result.Item == null) return [];
  return Object.entries(result.Item)
    .filter(([key]) => key.startsWith('mute_'))
    .map(([key]) => key.substring('mute_'.length))
    .sort();
};

export const deleteMuteWord = async (
  subscriberDid: string,
  muteWord: string
) => {
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: USER_SETTINGS_TABLE,
      Key: {
        subscriberDid,
      },
      UpdateExpression: 'REMOVE #word',
      ExpressionAttributeNames: {
        '#word': `mute_${muteWord}`,
      },
    })
  );
};

export const addMuteWord = async (subscriberDid: string, muteWord: string) => {
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: USER_SETTINGS_TABLE,
      Key: {
        subscriberDid,
      },
      UpdateExpression: 'SET #word = :true',
      ExpressionAttributeNames: {
        '#word': `mute_${muteWord}`,
      },
      ExpressionAttributeValues: {
        ':true': true,
      },
    })
  );
};
