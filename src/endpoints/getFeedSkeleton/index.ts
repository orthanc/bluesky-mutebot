import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  console.log(JSON.stringify(event, undefined, 2));
  return {
    statusCode: 200,
    body: JSON.stringify({
      feed: [
        {
          post: 'at://did:plc:crngjmsdh3zpuhmd5gtgwx6q/app.bsky.feed.post/3ka3p3th2ss2c',
        },
        {
          post: 'at://did:plc:crngjmsdh3zpuhmd5gtgwx6q/app.bsky.feed.post/3ka3xgyn4e62w',
        },
      ],
    }),
    headers: {
      'content-type': 'application/json',
    },
  };
};
