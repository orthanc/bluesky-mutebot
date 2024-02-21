import {
  DynamoDBDocumentClient,
  GetCommand,
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

type MuteWordValue = { muteUntil: string };

export type MutedWord = { word: string } & (
  | { forever: true }
  | { forever: false; muteUntil: string }
);

export const getMuteWords = async (
  subscriberDid: string
): Promise<Array<MutedWord>> => {
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
    .map(([key, value]): MutedWord => {
      const word = key.substring('mute_'.length);
      if (value === true) {
        return {
          word,
          forever: true,
        };
      }
      const val = value as MuteWordValue;
      return {
        ...val,
        word,
        forever: false,
      };
    })
    .sort((a, b) => a.word.localeCompare(b.word));
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

export const addMuteWord = async (
  subscriberDid: string,
  muteWord: string,
  muteUntil?: string
): Promise<MutedWord> => {
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: USER_SETTINGS_TABLE,
      Key: {
        subscriberDid,
      },
      UpdateExpression: 'SET #word = :value',
      ExpressionAttributeNames: {
        '#word': `mute_${muteWord}`,
      },
      ExpressionAttributeValues: {
        ':value':
          muteUntil == null
            ? true
            : {
                muteUntil,
              },
      },
    })
  );
  return muteUntil == null
    ? { word: muteWord, forever: true }
    : { word: muteWord, forever: false, muteUntil };
};
