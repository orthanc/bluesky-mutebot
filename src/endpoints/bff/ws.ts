import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import createHttpError from 'http-errors';
import middy from '@middy/core';
import httpErrorHandler from '@middy/http-error-handler';
import cors from '@middy/http-cors';

import {
  AuthorizedSessionRecord,
  createSession,
  getSessionBySessionId,
  updateSessionConnectionId,
} from './sessionStore';
import {
  addMuteWord,
  deleteMuteWord,
  getMuteWords,
} from '../../muteWordsStore';
import { renderMuteWords } from './components/MuteWords.';
import { renderEstablishingSession } from './components/EstablishingSession';
import { generateAuthToken, validateAuthToken } from '../../authTokens';
import { renderBleetToAuthorise } from './components/BleetToAuthorise';

const client = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_ENDPOINT,
});

const sendMuteWords = async (
  connectionId: string,
  session: AuthorizedSessionRecord
) => {
  const muteWords = await getMuteWords(session.subscriberDid);

  await client.send(
    new PostToConnectionCommand({
      // PostToConnectionRequest
      Data: renderMuteWords(muteWords),
      ConnectionId: connectionId,
    })
  );
};

export const rawHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (event.routeKey === 'POST /console/session') {
    const session = await createSession();
    const authToken = await generateAuthToken(
      'access-token-signing-key',
      session.sessionId,
      '15 minutes'
    );
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
        'HX-Trigger': JSON.stringify({
          'mutebot:auth-token-issued': authToken,
        }),
        'HX-Trigger-After-Settle': 'mutebot:load-bleet',
      },
      body: renderEstablishingSession(false),
    };
  }

  const { connectionId } = event.requestContext as { connectionId?: string };

  console.log(JSON.stringify(event));
  const authHeader =
    connectionId == null
      ? event.headers.authorization
      : JSON.parse(event.body as string).HEADERS.Authorization;
  const authToken = authHeader?.replace(/^Bearer /, '').trim();
  if (authToken == null) {
    throw new (403, 'No Auth Token')();
  }
  const { sessionId } = await validateAuthToken(
    'access-token-signing-key',
    authToken
  );
  const session = await getSessionBySessionId(sessionId);
  if (session == null) {
    throw createHttpError(403, 'Unknown Session');
  }

  if (connectionId != null) {
    const body = JSON.parse(event.body as string);
    if (body.loadBleetToAuthorize) {
      if (session.connectionId != connectionId) {
        await updateSessionConnectionId(sessionId, connectionId);
      }
      await client.send(
        new PostToConnectionCommand({
          Data: renderBleetToAuthorise(session.authKey),
          ConnectionId: connectionId,
        })
      );
    } else if (body.ensureConnectionId) {
      if (session.connectionId != connectionId) {
        await updateSessionConnectionId(sessionId, connectionId);
      }
    }
    if (session.status === 'authorized') {
      if (body.unmuteWord) {
        await deleteMuteWord(session.subscriberDid, body.unmuteWord);
        await sendMuteWords(connectionId, session);
      } else if (body.muteWord) {
        await addMuteWord(session.subscriberDid, body.muteWord);
        await sendMuteWords(connectionId, session);
      } else if (body.loadMuteWords) {
        await sendMuteWords(connectionId, session);
      }
    }

    return {
      statusCode: 204,
    };
  }
  switch (event.routeKey) {
    case 'POST /console/session/poll-authorised': {
      if (session.status === 'pending') {
        return {
          statusCode: 204,
        };
      }
      const muteWords = await getMuteWords(session.subscriberDid);
      return {
        statusCode: 200,
        body: renderMuteWords(muteWords),
        headers: {
          'Content-Type': 'text/html',
        },
      };
    }
    default:
      throw createHttpError(404, 'Unknown route');
  }
};

export const handler = middy(rawHandler)
  .use(httpErrorHandler())
  .use(
    cors({
      exposeHeaders: 'HX-Trigger,HX-Trigger-After-Settle',
    })
  );
