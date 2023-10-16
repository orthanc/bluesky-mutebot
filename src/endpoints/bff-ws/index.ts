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
      Data: `
<div id="mute-words" hx-swap-oob="true">
    <ul>
    ${muteWords
      .map(
        (word) =>
          `<li><button name="unmuteWord" value="${word}" ws-send>Delete</button> ${word}</li>`
      )
      .join('\n')}
    </ul>
    <form ws-send>
      <input type="text" name="muteWord" placeholder="word to mute"/>
      <input type="submit" value="Mute"/>
    </form>
</div>`,
      ConnectionId: connectionId,
    })
  );
};

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const { connectionId } = event.requestContext as { connectionId?: string };
  if (connectionId == null) {
    throw new Error('Bad Request, no connection id');
  }
  const body = JSON.parse(event.body as string);
  console.log(JSON.stringify(event, undefined, 2));
  console.log(JSON.stringify(body, undefined, 2));
  if (body.authorize) {
    await createSession(connectionId);
    await client.send(
      new PostToConnectionCommand({
        // PostToConnectionRequest
        Data: `
<div id="content" hx-swap-oob="true">
    Establishing Session.....
</div>`,
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
