import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  QueryCommandOutput,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MUTE_WORDS_TABLE = process.env.MUTE_WORDS_TABLE as string;
const USER_SETTINGS_TABLE = process.env.USER_SETTINGS_TABLE as string;

export type MuteWordsOperation = {
  operation: 'mute' | 'unmute';
  subscriberDid: string;
  word: string;
};
const getMuteWordsOld = async (
  subscriberDid: string
): Promise<Array<string>> => {
  let ExclusiveStartKey: Record<string, string> | undefined = undefined;
  const muteWords: Array<string> = [];
  do {
    const result: QueryCommandOutput = await ddbDocClient.send(
      new QueryCommand({
        TableName: MUTE_WORDS_TABLE,
        KeyConditionExpression: 'subscriberDid = :subscriberDid',
        ExpressionAttributeValues: {
          ':subscriberDid': subscriberDid,
        },
        ExclusiveStartKey,
      })
    );
    (ExclusiveStartKey = result.LastEvaluatedKey),
      result.Items?.map(({ muteWord }) => muteWords.push(muteWord));
  } while (ExclusiveStartKey != null);
  return muteWords;
};

export const getMuteWords = async (
  subscriberDid: string
): Promise<Array<string>> => {
  const [oldMuteWords, userSettingsMuteWords] = await Promise.all([
    getMuteWordsOld(subscriberDid),
    (async () => {
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
        .map(([key]) => key.substring('mute_'.length));
    })(),
  ]);

  return userSettingsMuteWords
    .concat(
      oldMuteWords.filter((word) => !userSettingsMuteWords.includes(word))
    )
    .sort();
};

export const deleteMuteWord = async (
  subscriberDid: string,
  muteWord: string
) => {
  await ddbDocClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: MUTE_WORDS_TABLE,
            Key: {
              subscriberDid,
              muteWord,
            },
          },
        },
        {
          Update: {
            TableName: USER_SETTINGS_TABLE,
            Key: {
              subscriberDid,
            },
            UpdateExpression: 'REMOVE #word',
            ExpressionAttributeNames: {
              '#word': `mute_${muteWord}`,
            },
          },
        },
      ],
    })
  );
};

export const addMuteWord = async (subscriberDid: string, muteWord: string) => {
  await ddbDocClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: MUTE_WORDS_TABLE,
            Item: {
              subscriberDid,
              muteWord: muteWord.toLowerCase().trim(),
            },
          },
        },
        {
          Update: {
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
          },
        },
      ],
    })
  );
};
