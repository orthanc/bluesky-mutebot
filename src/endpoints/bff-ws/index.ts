import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi'; // ES Modules import
import { createSession, getSessionByConnectionId } from './sessionStore';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const client = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_ENDPOINT,
});

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const getMuteWords = async (subscriberDid: string): Promise<Array<string>> => {
  const TableName = process.env.MUTE_WORDS_TABLE as string;
  let ExclusiveStartKey: Record<string, string> | undefined = undefined;
  const muteWords: Array<string> = [];
  do {
    const result: QueryCommandOutput = await ddbDocClient.send(
      new QueryCommand({
        TableName,
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
  } else if (body.loadMuteWords) {
    const session = await getSessionByConnectionId(connectionId);
    if (session != null) {
      const muteWords = await getMuteWords(session.subscriberDid);

      await client.send(
        new PostToConnectionCommand({
          // PostToConnectionRequest
          Data: `
<div id="mute-words" hx-swap-oob="true">
    <ul>
    ${muteWords.map((word) => `<li>${word}</li>`)}
    </ul>
</div>`,
          ConnectionId: connectionId,
        })
      );
    }
  }

  return {
    statusCode: 204,
  };
};
