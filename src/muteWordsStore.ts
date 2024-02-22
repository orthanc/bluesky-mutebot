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

export type FollowedUserSettings = {
  handle: string;
  muteRetweetsUntil: string;
};

export type UserSettings = {
  muteWords: Array<MutedWord>;
  followedUserSettings: Record<string, FollowedUserSettings>;
};

export const getUserSettings = async (
  subscriberDid: string
): Promise<UserSettings> => {
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: USER_SETTINGS_TABLE,
      Key: {
        subscriberDid,
      },
    })
  );
  if (result.Item == null) return { muteWords: [], followedUserSettings: {} };
  return {
    muteWords: Object.entries(result.Item)
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
      .sort((a, b) => a.word.localeCompare(b.word)),
    followedUserSettings: Object.fromEntries(
      Object.entries(result.Item)
        .filter(([key]) => key.startsWith('followed_'))
        .map(([key, value]): [string, FollowedUserSettings] => {
          const followedDid = key.substring('followed_'.length);
          return [followedDid, value as FollowedUserSettings];
        })
        .sort(([, { handle: a }], [, { handle: b }]) => a.localeCompare(b))
    ),
  };
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

export const addFollowedUserSettings = async (
  subscriberDid: string,
  followedDid: string,
  followedHandle: string,
  muteRetweetsUntil: string
): Promise<FollowedUserSettings> => {
  const value: FollowedUserSettings = {
    handle: followedHandle,
    muteRetweetsUntil,
  };
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: USER_SETTINGS_TABLE,
      Key: {
        subscriberDid,
      },
      UpdateExpression: 'SET #followed = :value',
      ExpressionAttributeNames: {
        '#followed': `followed_${followedDid}`,
      },
      ExpressionAttributeValues: {
        ':value': value,
      },
    })
  );
  return value;
};

export const updateFollowedUserRetweetMuted = async (
  subscriberDid: string,
  followedDid: string,
  muteRetweetsUntil: string
): Promise<void> => {
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: USER_SETTINGS_TABLE,
      Key: {
        subscriberDid,
      },
      UpdateExpression: 'SET #followed.muteRetweetsUntil = :value',
      ExpressionAttributeNames: {
        '#followed': `followed_${followedDid}`,
      },
      ExpressionAttributeValues: {
        ':value': muteRetweetsUntil,
      },
    })
  );
};

export const deleteFollowedUserSettings = async (
  subscriberDid: string,
  followedDid: string
): Promise<void> => {
  await ddbDocClient.send(
    new UpdateCommand({
      TableName: USER_SETTINGS_TABLE,
      Key: {
        subscriberDid,
      },
      UpdateExpression: 'REMOVE #followed',
      ExpressionAttributeNames: {
        '#followed': `followed_${followedDid}`,
      },
    })
  );
};
