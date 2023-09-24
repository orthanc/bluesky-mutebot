import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
export const handler = async (
  ecent: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 200,
    body: 'hi',
    headers: {
      'content-type': 'text/plain',
    },
  };
};
