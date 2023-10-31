import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import {
  SessionRecord,
  addAuthKeyToSession,
  authorizeSession,
  getSessionBySessionId,
} from './sessionStore';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';
import { OperationsSubscription } from '../readFirehose/firehoseSubscription/subscribe';
import { postToPostTableRecord } from '../readFirehose/postToPostTableRecord';
import { getBskyAgent } from '../../bluesky';
import { renderBleetToAuthorise } from './components/BleetToAuthorise';
import { getMuteWords } from '../../muteWordsStore';
import { renderMuteWordsContent } from './components/MuteWordsContent';

const client = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_ENDPOINT,
});

const getApprovalPost = async (
  authKey: string,
  timeoutMillis: number,
  connectionId: string | undefined
) => {
  if (connectionId != null) {
    await client.send(
      new PostToConnectionCommand({
        Data: renderBleetToAuthorise(authKey),
        ConnectionId: connectionId,
      })
    );
  }

  const serviceUserDid = process.env.BLUESKY_SERVICE_USER_DID as string;
  const authRegex = new RegExp(`let me in ${authKey}`);
  const subscription = new OperationsSubscription({
    signal: AbortSignal.timeout(timeoutMillis),
  });
  for await (const event of subscription) {
    for (const post of event.posts.creates) {
      const postRecord = postToPostTableRecord(post, 0, {});
      if (postRecord.mentionedDids.includes(serviceUserDid)) {
        if (postRecord.textEntries[0]?.match(authRegex)) {
          return postRecord;
        }
      }
    }
  }
  throw new Error('Cannot find approval post');
};

export const rawHandler = async (
  event: SessionRecord,
  context: Context
): Promise<void> => {
  const { sessionId } = event;
  const session = await getSessionBySessionId(sessionId);
  if (session == null) return;
  const { connectionId } = session;

  const authKey = await addAuthKeyToSession(sessionId);
  const [approvalPost, agent] = await Promise.all([
    getApprovalPost(
      authKey,
      context.getRemainingTimeInMillis() - 5000,
      connectionId
    ),
    getBskyAgent(),
  ]);

  const profile = await agent.getProfile({ actor: approvalPost.author });

  const [muteWords] = await Promise.all([
    getMuteWords(profile.data.did),
    authorizeSession({
      sessionId,
      subscriberDid: profile.data.did,
      subscriberHandle: profile.data.handle,
    }),
  ]);
  await client.send(
    new PostToConnectionCommand({
      Data: renderMuteWordsContent(profile.data.handle, muteWords),
      ConnectionId: connectionId,
    })
  );
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  const event: DynamoDBStreamEvent = request.event;
  const key = unmarshall(
    event.Records[0].dynamodb?.NewImage as Record<string, AttributeValue>
  ) as SessionRecord;
  request.event = key;
});
