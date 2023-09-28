import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpErrors from 'http-errors';
import { verifyJwt } from '@atproto/xrpc-server';
import { DidResolver, MemoryCache } from '@atproto/did-resolver';
import { getBskyAgent } from '../../bluesky';
import {
  getSubscriberFollowingRecord,
  triggerSubscriberSync,
} from '../../followingStore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

const didCache = new MemoryCache();
const didResolver = new DidResolver(
  { plcUrl: 'https://plc.directory' },
  didCache
);

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
  const cursor = (event.queryStringParameters ?? {}).cursor;
  const [agent, following, muteWords] = await Promise.all([
    getBskyAgent(),
    getSubscriberFollowingRecord(requesterDid),
    getMuteWords(requesterDid),
    cursor == null ? triggerSubscriberSync(requesterDid) : Promise.resolve(),
  ]);
  console.log({ muteWords });
  const response7 =
    following == null
      ? { data: { feed: [], cursor: undefined } }
      : await agent.app.bsky.feed.getListFeed({
          list: process.env.BLUESKY_FOLLOWING_LIST ?? '?? unknown list ??',
          limit: 100,
          cursor,
        });

  const followingDids = new Set<string>();
  Object.keys(following?.following ?? {}).forEach((did) =>
    followingDids.add(did)
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      feed: response7.data.feed
        .filter((item) => {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          const postText: string | undefined = item.post.record.text;
          return (
            followingDids.has(item.post.author.did) &&
            (item.reply == null ||
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              followingDids.has(item.reply?.parent?.author?.did)) &&
            (postText == null ||
              !postText
                .toLowerCase()
                .split(/\s+/)
                .some((word) =>
                  muteWords.some((mutedWord) => word.startsWith(mutedWord))
                ))
          );
        })
        .map((item) => ({ post: item.post.uri })),
      cursor: response7.data.cursor,
    }),
    headers: {
      'content-type': 'application/json',
    },
  };
};

export const handler = middy(rawHandler).use(httpHeaderNormalizer());
