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

const SAME_AUTHOR_RETWEET_WINDOW_SIZE = 3;
const SAME_QUOTED_TWEET_WINDOW_SIZE = 5;
const SAME_EXTERNAL_WINDOW_SIZE = 5;

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

const loadPosts = async (
  feedContent: Array<{ indexedAt: string; post: PostTableRecord }>,
  followingDids: Set<string>,
  filterRepliesToFollowed: boolean
) => {
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
  const loadedPosts = await loadPosts(
    feedContent,
    followingDids,
    filterRepliesToFollowed
  );

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

const mutePost = (
  muteWords: Array<string>,
  muteRetweetsFrom: Set<string>,
  filterRepliesToFollowed: boolean,
  followingDids: Set<string>,
  loadedPosts: Record<string, PostTableRecord>,
  postRef: FeedEntry
): boolean => {
  if (postRef.type === 'repost' && muteRetweetsFrom.has(postRef.author))
    return true;
  const post =
    loadedPosts[
      postRef.type === 'post' ? postRef.uri : postRef.repostedPostUri
    ];
  // exclude posts we can't find
  if (post == null) return true;
  // should never happen, but for typing, if we get back a repost skip it
  if (post.type === 'repost') return true;

  // Exclude posts with muted words
  if (
    post.textEntries.some((postText) => {
      const lowerText = postText.toLowerCase();
      return muteWords.some((mutedWord) => lowerText.includes(mutedWord));
    })
  )
    return true;

  // Exclude replies to posts with muted words
  for (const referencedPostUri of [post.replyParentUri, post.quotedPostUri]) {
    if (referencedPostUri == null) continue;
    const referencedPost = loadedPosts[referencedPostUri];
    // Err on the side of caution, skip replies and quotes of posts we can't find
    if (referencedPost == null || referencedPost.type !== 'post') return true;

    // Don't return quotes or replies to posts with muted words
    if (
      referencedPost.textEntries.some((postText) => {
        const lowerText = postText.toLowerCase();
        return muteWords.some((mutedWord) => lowerText.includes(mutedWord));
      })
    )
      return true;
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
      return true;
    // exclude replies that are to a non followed
    if (
      post.isReply &&
      (post.replyParentAuthorDid == null ||
        !followingDids.has(post.replyParentAuthorDid))
    )
      return true;
  }

  return false;
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
  const loadedPosts = await loadPosts(
    feedContent,
    followingDids,
    filterRepliesToFollowed
  );

  let filteredFeedContent: Array<{ indexedAt: string; post: FeedEntry }> =
    feedContent.filter(
      ({ post: postRef }) =>
        !mutePost(
          muteWords,
          muteRetweetsFrom,
          filterRepliesToFollowed,
          followingDids,
          loadedPosts,
          postRef
        )
    );

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

type PostWithIndex = { indexedAt?: string; post: FeedEntry };

function* arrayGenerator<T>(arr: ReadonlyArray<T>) {
  for (const element of arr) {
    yield element;
  }
}

function* filterMutedPosts(
  muteWords: Array<string>,
  muteRetweetsFrom: Set<string>,
  filterRepliesToFollowed: boolean,
  followingDids: Set<string>,
  loadedPosts: Record<string, PostTableRecord>,
  gen: Generator<PostWithIndex>
) {
  for (const post of gen) {
    if (
      !mutePost(
        muteWords,
        muteRetweetsFrom,
        filterRepliesToFollowed,
        followingDids,
        loadedPosts,
        post.post
      )
    )
      yield post;
  }
}

const getPostUrl = ({ post }: PostWithIndex) =>
  post.type === 'post' ? post.uri : post.repostedPostUri;

const removeDuplicateFromBuffer = (
  loadedPosts: Record<string, PostTableRecord>,
  droppedPosts: Array<PostWithIndex>,
  buffer: Array<PostWithIndex>,
  windowSize: number,
  getKey: (entry: {
    entry: FeedEntry;
    post?: PostTableRecord;
  }) => string | undefined,
  dropped: () => void
) => {
  const slice = -(windowSize - 1);
  return (entry: PostWithIndex) => {
    const postUri = getPostUrl(entry);
    const post = loadedPosts[postUri];
    const key = getKey({ entry: entry.post, post });
    if (key == null) return;
    const toRemoveFromSliceIndex = buffer
      .slice(slice)
      .findIndex((bufferEntry) => {
        const bufferPostUri = getPostUrl(bufferEntry);
        const bufferPost = loadedPosts[bufferPostUri];
        return key === getKey({ entry: bufferEntry.post, post: bufferPost });
      });
    if (toRemoveFromSliceIndex !== -1) {
      const toRemoveIndex =
        Math.max(buffer.length + slice, 0) + toRemoveFromSliceIndex;
      const removedPost = buffer[toRemoveIndex];
      droppedPosts.push(removedPost);
      dropped();
      buffer.splice(toRemoveIndex, 1);
    }
  };
};

function* filterRepeatedContent(
  gen: Generator<PostWithIndex>,
  loadedPosts: Record<string, PostTableRecord>,
  droppedPosts: Array<PostWithIndex>,
  droppedBecause: {
    authorReposts: boolean;
    quotesOfSamePost: boolean;
    sameExternal: boolean;
  }
) {
  const maxWindowSize = Math.max(
    SAME_AUTHOR_RETWEET_WINDOW_SIZE,
    SAME_QUOTED_TWEET_WINDOW_SIZE,
    SAME_EXTERNAL_WINDOW_SIZE
  );
  const buffer: Array<PostWithIndex> = [];
  const removeRepostsFromAuthor = removeDuplicateFromBuffer(
    loadedPosts,
    droppedPosts,
    buffer,
    SAME_AUTHOR_RETWEET_WINDOW_SIZE,
    ({ entry }) => (entry.type === 'repost' ? entry.author : undefined),
    () => (droppedBecause.authorReposts = true)
  );
  const removeQuotesOfSamePost = removeDuplicateFromBuffer(
    loadedPosts,
    droppedPosts,
    buffer,
    SAME_QUOTED_TWEET_WINDOW_SIZE,
    ({ post }) => (post?.type === 'post' ? post.quotedPostUri : undefined),
    () => (droppedBecause.quotesOfSamePost = true)
  );
  const removeSameExternal = removeDuplicateFromBuffer(
    loadedPosts,
    droppedPosts,
    buffer,
    SAME_QUOTED_TWEET_WINDOW_SIZE,
    ({ post }) => (post?.type === 'post' ? post.externalUri : undefined),
    () => (droppedBecause.sameExternal = true)
  );
  for (const post of gen) {
    if (buffer.length >= maxWindowSize) {
      const firstPost = buffer.shift();
      if (firstPost != null) {
        yield firstPost;
      }
    }
    removeRepostsFromAuthor(post);
    removeQuotesOfSamePost(post);
    removeSameExternal(post);
    buffer.push(post);
  }
}

const filterFeedContentAlpha = async (
  feedContent: Array<{ indexedAt: string; post: PostTableRecord }>,
  following: FollowingRecord,
  muteWords: Array<string>,
  muteRetweetsFrom: Set<string>,
  filterRepliesToFollowed: boolean,
  limit: number
): Promise<{
  feed: Array<PostWithIndex>;
  droppedPosts: Array<PostWithIndex>;
}> => {
  const followingDids = new Set<string>();
  Object.keys(following.following).forEach((did) => followingDids.add(did));
  const loadedPosts = await loadPosts(
    feedContent,
    followingDids,
    filterRepliesToFollowed
  );

  const droppedPosts: Array<PostWithIndex> = [];
  const droppedBecause = {
    authorReposts: false,
    quotesOfSamePost: false,
    sameExternal: false,
  };
  const postsGenerator = arrayGenerator(feedContent);
  const withoutMutedPosts = filterMutedPosts(
    muteWords,
    muteRetweetsFrom,
    filterRepliesToFollowed,
    followingDids,
    loadedPosts,
    postsGenerator
  );
  const withoutRetweetStorms = filterRepeatedContent(
    withoutMutedPosts,
    loadedPosts,
    droppedPosts,
    droppedBecause
  );

  const filteredFeedContent: Array<PostWithIndex> = [];
  const seenPosts = new Set<string>();
  for (const feedEntry of withoutRetweetStorms) {
    if (filteredFeedContent.length > limit) {
      break;
    }
    const postUri = getPostUrl(feedEntry);
    // Remove posts of the same post so we only show the earliest one
    if (seenPosts.has(postUri)) {
      const existingIndex = filteredFeedContent.findIndex((feedEntry) => {
        return getPostUrl(feedEntry) === postUri;
      });
      if (existingIndex != -1) {
        filteredFeedContent.splice(existingIndex, 1);
      }
    }
    seenPosts.add(postUri);

    filteredFeedContent.push(feedEntry);
  }
  if (droppedBecause.authorReposts) {
    filteredFeedContent.unshift({
      indexedAt: '',
      post: {
        type: 'post',
        uri: 'at://did:plc:k626emd4xi4h3wxpd44s4wpk/app.bsky.feed.post/3knkq22pls22r',
      } as FeedEntry,
    });
  }
  if (droppedBecause.quotesOfSamePost) {
    filteredFeedContent.unshift({
      indexedAt: '',
      post: {
        type: 'post',
        uri: 'at://did:plc:k626emd4xi4h3wxpd44s4wpk/app.bsky.feed.post/3knkq3xzur22n',
      } as FeedEntry,
    });
  }
  if (droppedBecause.sameExternal) {
    filteredFeedContent.unshift({
      indexedAt: '',
      post: {
        type: 'post',
        uri: 'at://did:plc:k626emd4xi4h3wxpd44s4wpk/app.bsky.feed.post/3knkq5rlu4k2w',
      } as FeedEntry,
    });
  }
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
  // const { requesterDid, cursor, feed, limit } = {
  //   requesterDid: 'did:plc:crngjmsdh3zpuhmd5gtgwx6q',
  //   cursor: undefined,
  //   feed: process.env.DROPPED_POSTS_FEED_URL,
  //   limit: 30,
  // };
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
    ? filterFeedContentAlpha(
        loadedPosts,
        following,
        activeMuteWords,
        muteRetweetsFrom,
        isFollowerBased,
        limit
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
    if (feed === process.env.DROPPED_POSTS_FEED_URL) {
      filteredFeedContent = [...filterResult.droppedPosts].sort((a, b) => {
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
