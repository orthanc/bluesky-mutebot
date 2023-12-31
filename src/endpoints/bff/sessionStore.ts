import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { GenerateRandomCommand, KMSClient } from '@aws-sdk/client-kms';
import base64url from 'base64url';

type BaseSessionRecord = {
  sessionId: string;
  connectionId?: string;
  authKey?: string;
  expiresAt: number;
};
export type PendingSessionRecord = BaseSessionRecord & {
  status: 'pending';
};
export type AuthorizedSessionRecord = BaseSessionRecord & {
  status: 'authorized';
  subscriberDid: string;
  subscriberHandle: string;
};
export type SessionRecord = PendingSessionRecord | AuthorizedSessionRecord;

const kmsClient = new KMSClient({});
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const createAuthKey = async (): Promise<string> => {
  const randomResult = await kmsClient.send(
    new GenerateRandomCommand({
      NumberOfBytes: 9,
    })
  );

  if (randomResult.Plaintext == null)
    throw new Error('Unable to generate auth key');
  return base64url.encode(Buffer.from(randomResult.Plaintext));
};

export const createSession = async (
  connectionId?: string
): Promise<SessionRecord> => {
  const randomResult = await kmsClient.send(
    new GenerateRandomCommand({
      NumberOfBytes: 32,
    })
  );

  if (randomResult.Plaintext == null)
    throw new Error('Unable to generate session id');
  const sessionId = base64url.encode(Buffer.from(randomResult.Plaintext));

  const TableName = process.env.CONSOLE_SESSIONS_TABLE as string;
  const session: SessionRecord = {
    sessionId,
    ...(connectionId == null ? undefined : { connectionId }),
    status: 'pending',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  await ddbDocClient.send(
    new PutCommand({
      TableName,
      Item: session,
    })
  );
  return session;
};

export const addAuthKeyToSession = async (
  sessionId: string
): Promise<string> => {
  const authKey = await createAuthKey();
  const TableName = process.env.CONSOLE_SESSIONS_TABLE as string;
  await ddbDocClient.send(
    new UpdateCommand({
      TableName,
      Key: {
        sessionId,
      },
      UpdateExpression: 'SET authKey = :authKey',
      ExpressionAttributeValues: {
        ':authKey': authKey,
      },
    })
  );
  return authKey;
};

export const updateSessionConnectionId = async (
  sessionId: string,
  connectionId: string
) => {
  const TableName = process.env.CONSOLE_SESSIONS_TABLE as string;
  await ddbDocClient.send(
    new UpdateCommand({
      TableName,
      Key: {
        sessionId,
      },
      UpdateExpression: 'SET connectionId = :connectionId',
      ExpressionAttributeValues: {
        ':connectionId': connectionId,
      },
    })
  );
};

export const authorizeSession = async (
  opts: Pick<
    AuthorizedSessionRecord,
    'sessionId' | 'subscriberDid' | 'subscriberHandle'
  >
) => {
  const TableName = process.env.CONSOLE_SESSIONS_TABLE as string;
  await ddbDocClient.send(
    new UpdateCommand({
      TableName,
      Key: {
        sessionId: opts.sessionId,
      },
      UpdateExpression:
        'SET #status = :status, subscriberDid = :subscriberDid, subscriberHandle = :subscriberHandle',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'authorized',
        ':subscriberDid': opts.subscriberDid,
        ':subscriberHandle': opts.subscriberHandle,
      },
    })
  );
};

export const getSessionBySessionId = async (
  sessionId: string
): Promise<SessionRecord | undefined> => {
  const TableName = process.env.CONSOLE_SESSIONS_TABLE as string;
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName,
      Key: { sessionId },
    })
  );
  if (result.Item == null) return undefined;
  return result.Item as SessionRecord;
};

export const getSessionByConnectionId = async (
  connectionId: string
): Promise<SessionRecord | undefined> => {
  const TableName = process.env.CONSOLE_SESSIONS_TABLE as string;
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName,
      IndexName: 'ByConnectionId',
      KeyConditionExpression: 'connectionId = :connectionId',
      ExpressionAttributeValues: {
        ':connectionId': connectionId,
      },
      Limit: 1,
    })
  );
  if (result.Items == null || result.Items.length === 0) return undefined;
  return result.Items[0] as SessionRecord;
};
