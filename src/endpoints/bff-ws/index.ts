import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi'; // ES Modules import
import {
  AuthorizedSessionRecord,
  createSession,
  getSessionByConnectionId,
} from './sessionStore';
import {
  addMuteWord,
  deleteMuteWord,
  getMuteWords,
} from '../../muteWordsStore';
import { renderMuteWords } from './components/MuteWords.';
import { renderEstablishingSession } from './components/EstablishingSession';
import { generateAuthToken } from '../../authTokens';

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

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  switch (event.routeKey) {
    case 'POST /console/session': {
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
          'Access-Control-Expose-Headers': 'HX-Trigger',
        },
        body: renderEstablishingSession(false),
      };
    }
  }
  const { connectionId } = event.requestContext as { connectionId?: string };
  if (connectionId == null) {
    throw new Error('Bad Request, no connection id');
  }
  const body = JSON.parse(event.body as string);
  if (body.authorize) {
    await createSession(connectionId);
    await client.send(
      new PostToConnectionCommand({
        // PostToConnectionRequest
        Data: renderEstablishingSession(true),
        ConnectionId: connectionId,
      })
    );
  } else {
    const session = await getSessionByConnectionId(connectionId);
    if (session != null) {
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
  }

  return {
    statusCode: 204,
  };
};
