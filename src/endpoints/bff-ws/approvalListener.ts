import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { SessionRecord, authorizeSession, createAuthKey } from './sessionStore';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';
import { OperationsSubscription } from '../readFirehose/firehoseSubscription/subscribe';
import { postToPostTableRecord } from '../readFirehose/postToPostTableRecord';
import { getBskyAgent } from '../../bluesky';

const client = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_ENDPOINT,
});

const getApprovalPost = async (connectionId: string, timeoutMillis: number) => {
  const authKey = await createAuthKey();

  await client.send(
    new PostToConnectionCommand({
      Data: `
<div id="content" hx-swap-oob="true">
    Bleet the following to login to Mutebot
    <pre>@${process.env.BLUESKY_SERVICE_IDENTIFIER} let me in ${authKey}</pre>
</div>`,
      ConnectionId: connectionId,
    })
  );

  const serviceUserDid = process.env.BLUESKY_SERVICE_USER_DID as string;
  const authRegex = new RegExp(`let me in ${authKey}`);
  const subscription = new OperationsSubscription({
    signal: AbortSignal.timeout(timeoutMillis),
  });
  for await (const event of subscription) {
    for (const post of event.posts.creates) {
      const postRecord = postToPostTableRecord(post, 0);
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
  console.log(event);

  const connectionId = event.connectionId;

  const [approvalPost, agent] = await Promise.all([
    getApprovalPost(connectionId, context.getRemainingTimeInMillis() - 5000),
    getBskyAgent(),
  ]);

  const profile = await agent.getProfile({ actor: approvalPost.author });

  await authorizeSession({
    sessionId: event.sessionId,
    subscriberDid: profile.data.did,
    subscriberHandle: profile.data.handle,
  });
  await client.send(
    new PostToConnectionCommand({
      Data: `
<div id="content" hx-swap-oob="true">
      <h1>Welcome ${profile.data.handle}</h1>
      <div id="mute-words">
      </div>
      <form id="form" ws-send>
            <input type="submit" name="loadMuteWords" value="Get Mute Words"/>
        </form>
</div>`,
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
