import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpErrors from 'http-errors';
import { verifyJwt } from '@atproto/xrpc-server';
import { DidResolver, MemoryCache } from '@atproto/did-resolver';
import { getBskyAgent } from '../../bluesky';
import { getSubscriberFollowingRecord } from '../../followingStore';

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

  const [agent, following] = await Promise.all([
    getBskyAgent(),
    getSubscriberFollowingRecord(requesterDid),
  ]);
  const response7 =
    following == null
      ? { data: { feed: [], cursor: undefined } }
      : await agent.app.bsky.feed.getListFeed({
          list: process.env.BLUESKY_FOLLOWING_LIST ?? '?? unknown list ??',
          cursor: (event.queryStringParameters ?? {}).cursor,
        });

  const followingDids = new Set<string>();
  Object.keys(following?.following ?? {}).forEach((did) =>
    followingDids.add(did)
  );

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
        ...response7.data.feed
          .filter((item) => {
            console.log({
              author: item.post.author.did,
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              parentAuthor: item.reply?.parent?.author?.did,
              following: followingDids.has(item.post.author.did),
              followingParent:
                item.reply == null ||
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                followingDids.has(item.reply?.parent?.author?.did),
            });
            return (
              followingDids.has(item.post.author.did) &&
              (item.reply == null ||
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                followingDids.has(item.reply?.parent?.author?.did))
            );
          })
          .map((item) => ({ post: item.post.uri })),
      ],
      cursor: response7.data.cursor,
    }),
    headers: {
      'content-type': 'application/json',
    },
  };
};

export const handler = middy(rawHandler).use(httpHeaderNormalizer());
