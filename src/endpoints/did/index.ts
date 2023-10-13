import { APIGatewayProxyResultV2 } from 'aws-lambda';
export const handler = async (): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: `did:web:${process.env.PUBLIC_HOSTNAME}`,
      service: [
        {
          id: '#bsky_fg',
          type: 'BskyFeedGenerator',
          serviceEndpoint: `https://${process.env.PUBLIC_HOSTNAME}`,
        },
      ],
    }),
    headers: {
      'content-type': 'application/json',
    },
  };
};
