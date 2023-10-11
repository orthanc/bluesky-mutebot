import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpErrors from 'http-errors';
import { verifyJwt } from '@atproto/xrpc-server';
import { DidResolver } from '@atproto/identity';
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
import { getPosts, listFeed } from '../../postsStore';

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

const didResolver = new DidResolver({ plcUrl: 'https://plc.directory' });

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

  if (requesterDid !== 'did:plc:crngjmsdh3zpuhmd5gtgwx6q') {
    return {
      statusCode: 200,
      body: JSON.stringify({
        feed: [
          {
            post: 'at://did:plc:k626emd4xi4h3wxpd44s4wpk/app.bsky.feed.post/3karzmn5bdp26',
          },
        ],
      }),
      headers: {
        'content-type': 'application/json',
      },
    };
  }

  console.log({ requesterDid });
  const {
    cursor,
    feed,
    limit: limitString,
  } = event.queryStringParameters ?? {};
  let limit = limitString == null ? -1 : parseInt(limitString);
  if (limit == null || limit <= 0) {
    limit = 30;
  }

  const [feedContent, following, muteWords] = await Promise.all([
    listFeed(requesterDid, limit, cursor),

    getSubscriberFollowingRecord(requesterDid),
    getMuteWords(requesterDid),
    cursor == null ? triggerSubscriberSync(requesterDid) : Promise.resolve(),
  ]);
  const postUris = new Set<string>();
  feedContent.posts.forEach((post) => {
    post.type === 'post'
      ? postUris.add(post.uri)
      : postUris.add(post.repostedPostUri);
  });
  const loadedPosts = await getPosts(Array.from(postUris));

  const followingDids = new Set<string>();
  Object.keys(following?.following ?? {}).forEach((did) =>
    followingDids.add(did)
  );
  const filteredFeedContent = feedContent.posts.filter((postRef) => {
    const post =
      loadedPosts[
        postRef.type === 'post' ? postRef.uri : postRef.repostedPostUri
      ];
    // exclude posts we can't find
    if (post == null) return false;
    // should never happen, but for typing, if we get back a repost skip it
    if (post.type === 'repost') return false;
    // Exclude posts that start with an @ mention of a non following as these are basically replies to an non following
    if (
      post.startsWithMention &&
      !post.mentionedDids.some((mentionedDid) =>
        followingDids.has(mentionedDid)
      )
    )
      return false;
    // exclude replies that are to a non followed
    if (
      post.isReply &&
      (post.replyParentAuthorDid == null ||
        !followingDids.has(post.replyParentAuthorDid))
    )
      return false;
    // Exclude posts with muted words
    if (
      post.textEntries.some((postText) =>
        postText
          .toLowerCase()
          .split(/\s+/)
          .some((word) =>
            muteWords.some((mutedWord) => word.startsWith(mutedWord))
          )
      )
    )
      return false;
    // Exclude replies to posts with muted words
    if (
      post.isReply &&
      (post.replyParentTextEntries == null ||
        post.replyParentTextEntries.some((postText) =>
          postText
            .toLowerCase()
            .split(/\s+/)
            .some((word) =>
              muteWords.some((mutedWord) => word.startsWith(mutedWord))
            )
        ))
    )
      return false;
    return true;
  });
  return {
    statusCode: 200,
    body: JSON.stringify({
      feed: filteredFeedContent.map((post) =>
        post.type === 'post'
          ? { post: post.uri }
          : {
              post: post.repostedPostUri,
              reason: {
                $type: 'app.bsky.feed.defs#skeletonReasonRepost',
                repost: post.uri,
              },
            }
      ),
      cursor: feedContent.cursor,
    }),
    headers: {
      'content-type': 'application/json',
    },
  };

  // const [agent, following, muteWords] = await Promise.all([
  //   getBskyAgent(),
  //   getSubscriberFollowingRecord(requesterDid),
  //   getMuteWords(requesterDid),
  //   cursor == null ? triggerSubscriberSync(requesterDid) : Promise.resolve(),
  // ]);
  // console.log({ muteWords });
  // const response7 =
  //   following == null
  //     ? { data: { feed: [], cursor: undefined } }
  //     : await agent.getTimeline({
  //         limit: 100,
  //         cursor,
  //       });

  // const followingDids = new Set<string>();
  // Object.keys(following?.following ?? {}).forEach((did) =>
  //   followingDids.add(did)
  // );

  // return {
  //   statusCode: 200,
  //   body: JSON.stringify({
  //     feed: response7.data.feed
  //       .filter((item) => {
  //         // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //         // @ts-expect-error
  //         const postText: string | undefined = item.post.record.text;
  //         return (
  //           followingDids.has(item.post.author.did) &&
  //           (item.reply == null ||
  //             // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //             // @ts-ignore
  //             followingDids.has(item.reply?.parent?.author?.did)) &&
  //           (postText == null ||
  //             !postText
  //               .toLowerCase()
  //               .split(/\s+/)
  //               .some((word) =>
  //                 muteWords.some((mutedWord) => word.startsWith(mutedWord))
  //               ))
  //         );
  //       })
  //       .map((item) => ({ post: item.post.uri })),
  //     cursor: response7.data.cursor,
  //   }),
  //   headers: {
  //     'content-type': 'application/json',
  //   },
  // };
};

export const handler = middy(rawHandler).use(httpHeaderNormalizer());
