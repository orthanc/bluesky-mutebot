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
import {
  FeedEntry,
  PostTableRecord,
  getPosts,
  listFeedFromPosts,
} from '../../postsStore';
import { getMuteWords } from '../../muteWordsStore';

const didResolver = new DidResolver({ plcUrl: 'https://plc.directory' });

const SYNCING_FOLLOING_POST =
  'at://did:plc:k626emd4xi4h3wxpd44s4wpk/app.bsky.feed.post/3kbhiegyf3x2w';
const NO_MORE_POSTS_POST =
  'at://did:plc:k626emd4xi4h3wxpd44s4wpk/app.bsky.feed.post/3kbhiodpr4m2d';

export const rawHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
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

  const {
    cursor,
    feed,
    limit: limitString,
  } = event.queryStringParameters ?? {};
  let limit = limitString == null ? -1 : parseInt(limitString);
  if (limit == null || limit <= 0) {
    limit = 30;
  }
  console.log({ requesterDid, cursor, feed, limit });

  if (feed !== process.env.FOLLOWING_FEED_URL) {
    console.log(`Unknown Feed ${feed}`);
    return {
      statusCode: 404,
      body: 'Unknown feed',
      headers: {
        'content-type': 'text/plain',
      },
    };
  }

  const [feedContent, following, muteWords] = await Promise.all([
    listFeedFromPosts(requesterDid, limit, cursor),
    getSubscriberFollowingRecord(requesterDid),
    getMuteWords(requesterDid),
    cursor == null && requesterDid !== process.env.BLUESKY_SERVICE_USER_DID
      ? triggerSubscriberSync(requesterDid)
      : Promise.resolve(),
  ]);

  if (Object.keys(following?.following ?? {}).length === 0) {
    console.log(`Returning First View Post`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        feed: [
          {
            post: SYNCING_FOLLOING_POST,
          },
        ],
      }),
      headers: {
        'content-type': 'application/json',
      },
    };
  }

  const loadedPosts: Record<string, PostTableRecord> = {};
  const postUris = new Set<string>();
  (feedContent.posts as Array<PostTableRecord>).forEach((post) => {
    if (post.type === 'post') {
      loadedPosts[post.uri] = post;
    } else {
      postUris.add(post.repostedPostUri);
    }
  });
  const loadedReposts = await getPosts(Array.from(postUris));
  Object.assign(loadedPosts, loadedReposts);

  const followingDids = new Set<string>();
  Object.keys(following.following).forEach((did) => followingDids.add(did));
  const filteredFeedContent: Array<FeedEntry> = feedContent.posts.filter(
    (postRef) => {
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
        post.textEntries.some((postText) => {
          const lowerText = postText.toLowerCase();
          return muteWords.some((mutedWord) => lowerText.includes(mutedWord));
        })
      )
        return false;
      // Exclude replies to posts with muted words
      if (
        post.isReply &&
        (post.replyParentTextEntries == null ||
          post.replyParentTextEntries.some((postText) => {
            const lowerText = postText.toLowerCase();
            return muteWords.some((mutedWord) =>
              lowerText.includes(mutedWord.trim())
            );
          }))
      )
        return false;
      return true;
    }
  );
  if (feedContent.cursor == null) {
    filteredFeedContent.push({
      uri: NO_MORE_POSTS_POST,
      type: 'post',
    } as FeedEntry);
  }
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
};

export const handler = middy(rawHandler).use(httpHeaderNormalizer());
