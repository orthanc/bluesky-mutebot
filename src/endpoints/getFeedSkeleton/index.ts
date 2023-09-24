import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpErrors from 'http-errors';
import { verifyJwt } from '@atproto/xrpc-server';
import { DidResolver, MemoryCache } from '@atproto/did-resolver';

const didCache = new MemoryCache();
const didResolver = new DidResolver(
  { plcUrl: 'https://plc.directory' },
  didCache
);

export const rawHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  console.log(JSON.stringify(event, undefined, 2));

  const { authorization = '' } = event.headers;
  if (!authorization.startsWith('Bearer ')) {
    throw new httpErrors.Unauthorized();
  }
  const jwt = authorization.replace('Bearer ', '').trim();
  const requesterDid = await verifyJwt(
    jwt,
    `did:web:${process.env.PUBLIC_HOSTNAME}`,
    async (did: string) => {
      return didResolver.resolveAtprotoKey(did);
    }
  );

  console.log({ requesterDid });

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

export const handler = middy(rawHandler).use(httpHeaderNormalizer());
