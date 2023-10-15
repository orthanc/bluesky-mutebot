import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi'; // ES Modules import
import { createSession } from './sessionStore';

const client = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_ENDPOINT,
});

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
    const input = {
      // PostToConnectionRequest
      Data: `
<div id="content" hx-swap-oob="true">
    Establishing Session.....
</div>`,
      ConnectionId: connectionId,
    };
    const command = new PostToConnectionCommand(input);
    await client.send(command);
  }

  return {
    statusCode: 204,
  };
};
