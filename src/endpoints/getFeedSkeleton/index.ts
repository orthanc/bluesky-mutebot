import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpErrors from 'http-errors';
import { verifyJwt } from '@atproto/xrpc-server';
import { DidResolver } from '@atproto/identity';
import type { Record as PostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import {
  FollowingRecord,
  getSubscriberFollowingRecord,
  triggerSubscriberSync,
} from '../../followingStore';
import {
  FeedEntry,
  POST_RETENTION_SECONDS,
  PostTableRecord,
  listFeedFromUserFeedRecord,
} from '../../postsStore';
import { getUserSettings } from '../../muteWordsStore';
import { getBskyAgent } from '../../bluesky';
import { postToPostTableRecord } from '../readFirehose/postToPostTableRecord';

const didResolver = new DidResolver({ plcUrl: 'https://plc.directory' });

const SYNCING_FOLLOING_POST =
  'at://did:plc:k626emd4xi4h3wxpd44s4wpk/app.bsky.feed.post/3kbhiegyf3x2w';
const NO_MORE_POSTS_POST =
  'at://did:plc:k626emd4xi4h3wxpd44s4wpk/app.bsky.feed.post/3kbhiodpr4m2d';
const REPOSTS_DROPPED_POST =
  'at://did:plc:k626emd4xi4h3wxpd44s4wpk/app.bsky.feed.post/3kmrm4hqefm2s';

const WINDOW_SIZE = 3;

const resolvePosts = async (
  postUris: Array<string>
): Promise<Record<string, PostTableRecord>> => {
  const agent = await getBskyAgent();
  let toResolve = postUris.map((uri) => ({ uri, resolveMore: true }));
  const loadedPosts: Record<string, PostTableRecord> = {};
  const expiresAt = Math.floor(Date.now() / 1000) + POST_RETENTION_SECONDS;
  while (toResolve.length > 0) {
    const batch = toResolve.slice(0, 25);
    toResolve = toResolve.slice(25);
    const postsResponse = await agent.getPosts({
      uris: batch.map(({ uri }) => uri),
    });
    postsResponse.data.posts.forEach((post) => {
      const record = postToPostTableRecord(
        {
          author: post.author.did,
          record: post.record as PostRecord,
          uri: post.uri,
        },
        expiresAt,
        {}
      );
      loadedPosts[record.uri] = record;
    });
    batch.forEach(({ uri, resolveMore }) => {
      const post = loadedPosts[uri];
      if (resolveMore && post != null && post.type === 'post') {
        if (resolveMore && post.replyParentUri != null) {
          toResolve.push({ uri: post.replyParentUri, resolveMore: false });
        }
        if (resolveMore && post.quotedPostUri != null) {
          toResolve.push({ uri: post.quotedPostUri, resolveMore: false });
        }
      }
    });
  }
  return loadedPosts;
};

const filterFeedContent = async (
  feedContent: Array<{ indexedAt: string; post: PostTableRecord }>,
  following: FollowingRecord,
  muteWords: Array<string>,
  muteRetweetsFrom: Set<string>,
  filterRepliesToFollowed: boolean
): Promise<{
  feed: Array<{ indexedAt?: string; post: FeedEntry }>;
  droppedPosts: Array<{ indexedAt?: string; post: FeedEntry }>;
}> => {
  const followingDids = new Set<string>();
  Object.keys(following.following).forEach((did) => followingDids.add(did));
  const loadedPosts: Record<string, PostTableRecord> = {};
  const postUris = new Set<string>();
  feedContent.forEach(({ post }) => {
    if (post.type === 'post') {
      loadedPosts[post.uri] = post;
    } else {
      postUris.add(post.repostedPostUri);
    }
  });
  feedContent.forEach(({ post }) => {
    if (post.type === 'post') {
      // If it is a reply to a post we don't already have
      if (
        post.replyParentUri != null &&
        loadedPosts[post.replyParentUri] == null
      ) {
        // And it is a reply to someone followed (otherwise it would be filtered out anyway)
        if (
          !filterRepliesToFollowed ||
          (post.replyParentAuthorDid != null &&
            followingDids.has(post.replyParentAuthorDid))
        ) {
          postUris.add(post.replyParentUri);
        }
      }

      // If it's a quote of a post we don't already have
      if (
        post.quotedPostUri != null &&
        loadedPosts[post.quotedPostUri] == null
      ) {
        postUris.add(post.quotedPostUri);
      }
    }
  });
  if (postUris.size > 0) {
    const externallyResolvedPosts = await resolvePosts(Array.from(postUris));
    Object.assign(loadedPosts, externallyResolvedPosts);
  }
  console.log({
    feedPosts: feedContent.length,
    externallyResolvedPosts: postUris.size,
    totalPosts: Object.keys(loadedPosts).length,
  });

  let filteredFeedContent: Array<{ indexedAt: string; post: FeedEntry }> =
    feedContent.filter(({ post: postRef }) => {
      if (postRef.type === 'repost' && muteRetweetsFrom.has(postRef.author))
        return false;
      const post =
        loadedPosts[
          postRef.type === 'post' ? postRef.uri : postRef.repostedPostUri
        ];
      // exclude posts we can't find
      if (post == null) return false;
      // should never happen, but for typing, if we get back a repost skip it
      if (post.type === 'repost') return false;

      // Exclude posts with muted words
      if (
        post.textEntries.some((postText) => {
          const lowerText = postText.toLowerCase();
          return muteWords.some((mutedWord) => lowerText.includes(mutedWord));
        })
      )
        return false;
      // Exclude replies to posts with muted words
      for (const referencedPostUri of [
        post.replyParentUri,
        post.quotedPostUri,
      ]) {
        if (referencedPostUri == null) continue;
        const referencedPost = loadedPosts[referencedPostUri];
        // Err on the side of caution, skip replies and quotes of posts we can't find
        if (referencedPost == null || referencedPost.type !== 'post')
          return false;

        // Don't return quotes or replies to posts with muted words
        if (
          referencedPost.textEntries.some((postText) => {
            const lowerText = postText.toLowerCase();
            return muteWords.some((mutedWord) => lowerText.includes(mutedWord));
          })
        )
          return false;
      }

      // We don't filter out replies or @ mentions if they were reposted since repost indicates they want
      // to be shared wider
      if (filterRepliesToFollowed && postRef.type !== 'repost') {
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
      }
      return true;
    });

  // Determine the highest index that each post and external link is
  const firstSeenPost: Record<string, number> = {};
  const firstSeenExternal: Record<string, number> = {};
  filteredFeedContent.forEach(({ post: postRef }, index) => {
    const postUri =
      postRef.type === 'post' ? postRef.uri : postRef.repostedPostUri;
    firstSeenPost[postUri] = index;
    const post = loadedPosts[postUri];
    if (post?.type === 'post') {
      if (post.externalUri != null) {
        firstSeenExternal[post.externalUri] = index;
      }

      if (post.replyParentUri != null) {
        const parentPost = loadedPosts[post.replyParentUri];
        if (parentPost == null || parentPost.type === 'post') {
          if (parentPost.externalUri != null) {
            firstSeenExternal[parentPost.externalUri] = index;
          }
          if (parentPost.quotedPostUri != null) {
            firstSeenExternal[parentPost.quotedPostUri] = index;
          }
        }
      }
      if (post.quotedPostUri != null) {
        const quotedPost = loadedPosts[post.quotedPostUri];
        if (quotedPost == null || quotedPost.type === 'post') {
          if (quotedPost.externalUri != null) {
            firstSeenExternal[quotedPost.externalUri] = index;
          }
        }
      }
    }
  });

  filteredFeedContent = filteredFeedContent.filter(
    ({ post: postRef }, index) => {
      const postUri =
        postRef.type === 'post' ? postRef.uri : postRef.repostedPostUri;
      if (firstSeenPost[postUri] !== index) {
        console.log('skipping post');
        return false;
      }
      const post = loadedPosts[postUri];
      if (post?.type === 'post') {
        if (
          post.externalUri != null &&
          firstSeenExternal[post.externalUri] !== index
        ) {
          console.log('skipping external');
          return false;
        }
        if (post.quotedPostUri != null) {
          const quotedPost = loadedPosts[post.quotedPostUri];
          if (quotedPost == null || quotedPost.type === 'post') {
            if (
              quotedPost.externalUri != null &&
              firstSeenExternal[quotedPost.externalUri] !== index
            ) {
              console.log('skipping quoted external');
              return false;
            }
          }
        }
      }
      return true;
    }
  );

  return { feed: filteredFeedContent, droppedPosts: [] };
};

const filterFeedContentBeta = async (
  feedContent: Array<{ indexedAt: string; post: PostTableRecord }>,
  following: FollowingRecord,
  muteWords: Array<string>,
  muteRetweetsFrom: Set<string>,
  filterRepliesToFollowed: boolean
): Promise<{
  feed: Array<{ indexedAt?: string; post: FeedEntry }>;
  droppedPosts: Array<{ indexedAt?: string; post: FeedEntry }>;
}> => {
  const followingDids = new Set<string>();
  Object.keys(following.following).forEach((did) => followingDids.add(did));
  const loadedPosts: Record<string, PostTableRecord> = {};
  const postUris = new Set<string>();
  feedContent.forEach(({ post }) => {
    if (post.type === 'post') {
      loadedPosts[post.uri] = post;
    } else {
      postUris.add(post.repostedPostUri);
    }
  });
  feedContent.forEach(({ post }) => {
    if (post.type === 'post') {
      // If it is a reply to a post we don't already have
      if (
        post.replyParentUri != null &&
        loadedPosts[post.replyParentUri] == null
      ) {
        // And it is a reply to someone followed (otherwise it would be filtered out anyway)
        if (
          !filterRepliesToFollowed ||
          (post.replyParentAuthorDid != null &&
            followingDids.has(post.replyParentAuthorDid))
        ) {
          postUris.add(post.replyParentUri);
        }
      }

      // If it's a quote of a post we don't already have
      if (
        post.quotedPostUri != null &&
        loadedPosts[post.quotedPostUri] == null
      ) {
        postUris.add(post.quotedPostUri);
      }
    }
  });
  if (postUris.size > 0) {
    const externallyResolvedPosts = await resolvePosts(Array.from(postUris));
    Object.assign(loadedPosts, externallyResolvedPosts);
  }
  console.log({
    feedPosts: feedContent.length,
    externallyResolvedPosts: postUris.size,
    totalPosts: Object.keys(loadedPosts).length,
  });

  let filteredFeedContent: Array<{ indexedAt: string; post: FeedEntry }> =
    feedContent.filter(({ post: postRef }) => {
      if (postRef.type === 'repost' && muteRetweetsFrom.has(postRef.author))
        return false;
      const post =
        loadedPosts[
          postRef.type === 'post' ? postRef.uri : postRef.repostedPostUri
        ];
      // exclude posts we can't find
      if (post == null) return false;
      // should never happen, but for typing, if we get back a repost skip it
      if (post.type === 'repost') return false;

      // Exclude posts with muted words
      if (
        post.textEntries.some((postText) => {
          const lowerText = postText.toLowerCase();
          return muteWords.some((mutedWord) => lowerText.includes(mutedWord));
        })
      )
        return false;
      // Exclude replies to posts with muted words
      for (const referencedPostUri of [
        post.replyParentUri,
        post.quotedPostUri,
      ]) {
        if (referencedPostUri == null) continue;
        const referencedPost = loadedPosts[referencedPostUri];
        // Err on the side of caution, skip replies and quotes of posts we can't find
        if (referencedPost == null || referencedPost.type !== 'post')
          return false;

        // Don't return quotes or replies to posts with muted words
        if (
          referencedPost.textEntries.some((postText) => {
            const lowerText = postText.toLowerCase();
            return muteWords.some((mutedWord) => lowerText.includes(mutedWord));
          })
        )
          return false;
      }

      // We don't filter out replies or @ mentions if they were reposted since repost indicates they want
      // to be shared wider
      if (filterRepliesToFollowed && postRef.type !== 'repost') {
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
      }
      return true;
    });

  // Determine the highest index that each post and external link is
  const firstSeenPost: Record<string, number> = {};
  const firstSeenExternal: Record<string, number> = {};
  filteredFeedContent.forEach(({ post: postRef }, index) => {
    const postUri =
      postRef.type === 'post' ? postRef.uri : postRef.repostedPostUri;
    firstSeenPost[postUri] = index;
    const post = loadedPosts[postUri];
    if (post?.type === 'post') {
      if (post.externalUri != null) {
        firstSeenExternal[post.externalUri] = index;
      }

      if (post.replyParentUri != null) {
        const parentPost = loadedPosts[post.replyParentUri];
        if (parentPost == null || parentPost.type === 'post') {
          if (parentPost.externalUri != null) {
            firstSeenExternal[parentPost.externalUri] = index;
          }
          if (parentPost.quotedPostUri != null) {
            firstSeenExternal[parentPost.quotedPostUri] = index;
          }
        }
      }
      if (post.quotedPostUri != null) {
        const quotedPost = loadedPosts[post.quotedPostUri];
        if (quotedPost == null || quotedPost.type === 'post') {
          if (quotedPost.externalUri != null) {
            firstSeenExternal[quotedPost.externalUri] = index;
          }
        }
      }
    }
  });

  const droppedPosts: typeof filteredFeedContent = [];
  filteredFeedContent = filteredFeedContent.filter((entry, index) => {
    const { post: postRef } = entry;
    const postUri =
      postRef.type === 'post' ? postRef.uri : postRef.repostedPostUri;
    if (firstSeenPost[postUri] !== index) {
      console.log('skipping post');
      droppedPosts.push(entry);
      return false;
    }
    const post = loadedPosts[postUri];
    if (post?.type === 'post') {
      if (
        post.externalUri != null &&
        firstSeenExternal[post.externalUri] !== index
      ) {
        console.log('skipping external');
        droppedPosts.push(entry);
        return false;
      }
      if (post.quotedPostUri != null) {
        const quotedPost = loadedPosts[post.quotedPostUri];
        if (quotedPost == null || quotedPost.type === 'post') {
          if (
            quotedPost.externalUri != null &&
            firstSeenExternal[quotedPost.externalUri] !== index
          ) {
            console.log('skipping quoted external');
            droppedPosts.push(entry);
            return false;
          }
        }
      }
    }
    return true;
  });

  return { feed: filteredFeedContent, droppedPosts };
};

const fetchKikorangi = async (
  limit?: number,
  cursor?: string
): ReturnType<typeof listFeedFromUserFeedRecord> => {
  const result = await (
    await getBskyAgent()
  ).app.bsky.feed.getFeed({
    feed: 'at://did:plc:65yo7ynzcyp4kpwsienyukrz/app.bsky.feed.generator/aaadfjfgt73ls',
    limit,
    cursor,
  });
  return {
    posts: result.data.feed.map((entry) => ({
      post: postToPostTableRecord(
        {
          record: entry.post.record as PostRecord,
          uri: entry.post.uri,
          author: entry.post.author.did,
        },
        9,
        {}
      ),
      indexedAt: '',
    })),
    cursor: result.data.cursor,
  };
};

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
    `did:web:${process.env.WEB_DOMAIN_NAME}`,
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

  if (
    feed !== process.env.FOLLOWING_FEED_URL &&
    feed !== process.env.BETA_FOLLOWING_FEED_URL &&
    feed !== process.env.DROPPED_POSTS_FEED_URL &&
    feed !== process.env.KIKORANGI_FEED_URL
  ) {
    console.log(`Unknown Feed ${feed}`);
    return {
      statusCode: 404,
      body: 'Unknown feed',
      headers: {
        'content-type': 'text/plain',
      },
    };
  }

  const isKikoragi = feed === process.env.KIKORANGI_FEED_URL;
  const isBeta =
    feed === process.env.BETA_FOLLOWING_FEED_URL ||
    feed === process.env.DROPPED_POSTS_FEED_URL;
  const isFollowerBased = feed === process.env.FOLLOWING_FEED_URL || isBeta;

  let startDate: string | undefined = undefined;
  let startPostUrl: string | undefined = undefined;
  if (cursor != null && cursor.startsWith('v2|')) {
    const parts = cursor.split('|');
    startDate = parts[1];
    startPostUrl = parts[2];
  }

  const [
    { posts: loadedPosts, cursor: sourceCursor },
    following,
    userSettings,
  ] = await Promise.all([
    isKikoragi
      ? fetchKikorangi(limit, cursor)
      : listFeedFromUserFeedRecord(
          requesterDid,
          limit,
          startDate,
          startPostUrl
        ),
    getSubscriberFollowingRecord(requesterDid),
    getUserSettings(requesterDid),
    cursor == null && requesterDid !== process.env.BLUESKY_SERVICE_USER_DID
      ? triggerSubscriberSync(requesterDid)
      : Promise.resolve(),
  ]);

  if (isFollowerBased && Object.keys(following?.following ?? {}).length === 0) {
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

  const now = new Date().toISOString();
  const activeMuteWords = userSettings.muteWords
    .filter((muteWord) => muteWord.forever || muteWord.muteUntil > now)
    .map((muteWord) => muteWord.word.toLowerCase().trim());

  const muteRetweetsFrom = new Set(
    Object.entries(userSettings.followedUserSettings)
      .filter(
        ([, followedSettings]) =>
          followedSettings.muteRetweetsUntil === 'forever' ||
          followedSettings.muteRetweetsUntil > now
      )
      .map(([did]) => did)
  );

  const filterResult = await (isBeta
    ? filterFeedContentBeta(
        loadedPosts,
        following,
        activeMuteWords,
        muteRetweetsFrom,
        isFollowerBased
      )
    : filterFeedContent(
        loadedPosts,
        following,
        activeMuteWords,
        muteRetweetsFrom,
        isFollowerBased
      ));
  let filteredFeedContent = filterResult.feed;

  let nextCursor: string | undefined = undefined;
  if (isKikoragi) {
    nextCursor = sourceCursor;
  } else if (isBeta) {
    const feedWithRemovedRetweets: typeof filteredFeedContent = [];
    const droppedPosts: typeof filteredFeedContent = [];
    let addedNotificationPost = false;
    const window: typeof filteredFeedContent = [];
    for (const post of filteredFeedContent) {
      if (feedWithRemovedRetweets.length > limit) {
        break;
      }
      if (window.length >= WINDOW_SIZE) {
        const firstPost = window.shift();
        if (firstPost != null) {
          feedWithRemovedRetweets.push(firstPost);
        }
      }
      if (post.post.type === 'repost') {
        const toRemoveIndex = window.findIndex(
          ({ post: postInWindow }) =>
            post.post.author === postInWindow.author &&
            postInWindow.type === 'repost'
        );
        if (toRemoveIndex !== -1) {
          const removedPost = window[toRemoveIndex];
          droppedPosts.push(removedPost);
          window.splice(toRemoveIndex, 1);

          if (!addedNotificationPost) {
            feedWithRemovedRetweets.unshift({
              indexedAt: '',
              post: {
                type: 'post',
                uri: REPOSTS_DROPPED_POST,
              } as FeedEntry,
            });
            addedNotificationPost = true;
          }
        }
      }
      window.push(post);
    }
    feedWithRemovedRetweets.push(...window);
    filteredFeedContent = feedWithRemovedRetweets;
    const nextPost = filteredFeedContent[limit];
    filteredFeedContent = filteredFeedContent.slice(0, limit);
    if (nextPost != null) {
      nextCursor = `v2|${nextPost.indexedAt}|${nextPost.post.uri}`;
    }
    if (feed === process.env.DROPPED_POSTS_FEED_URL) {
      filteredFeedContent = [
        ...droppedPosts,
        ...filterResult.droppedPosts,
      ].sort((a, b) => {
        if (a.post.createdAt < b.post.createdAt) return 1;
        if (a.post.createdAt > b.post.createdAt) return -1;
        return 0;
      });
    }
  } else {
    const nextPost = filteredFeedContent[limit];
    if (nextPost == null) {
      filteredFeedContent.push({
        post: {
          uri: NO_MORE_POSTS_POST,
          type: 'post',
        } as FeedEntry,
      });
    } else {
      nextCursor = `v2|${nextPost.indexedAt}|${nextPost.post.uri}`;
      filteredFeedContent = filteredFeedContent.slice(0, limit);
    }
  }
  return {
    statusCode: 200,
    body: JSON.stringify({
      feed: filteredFeedContent.map(({ post }) =>
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
      cursor: nextCursor,
    }),
    headers: {
      'content-type': 'application/json',
    },
  };
};

export const handler = middy(rawHandler).use(httpHeaderNormalizer());
