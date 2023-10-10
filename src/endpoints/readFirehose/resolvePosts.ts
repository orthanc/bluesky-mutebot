import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  PostTableRecord,
  getPosts,
  getPostsForExternalResolve,
  savePost,
  savePostsBatch,
} from '../../postsStore';
import { DynamoDBStreamEvent, SQSEvent } from 'aws-lambda';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { getBskyAgent } from '../../bluesky';
import type { Record as PostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import { postToPostTableRecord } from './postToPostTableRecord';
import { BskyAgent } from '@atproto/api';

const sqsClient = new SQSClient({});

const addUrisToLoad = (
  urisToLoad: Set<string>,
  unresolvedPost: PostTableRecord
) => {
  if (unresolvedPost.type === 'post') {
    if (
      unresolvedPost.replyParentUri != null &&
      unresolvedPost.replyParentAuthorDid == null
    ) {
      urisToLoad.add(unresolvedPost.replyParentUri);
    }
    if (
      unresolvedPost.replyRootUri != null &&
      unresolvedPost.replyRootAuthorDid == null
    ) {
      urisToLoad.add(unresolvedPost.replyRootUri);
    }
  } else if (unresolvedPost.type === 'repost') {
    urisToLoad.add(unresolvedPost.repostedPostUri);
  }
};

const populateResolvedPost = (
  resolvedPosts: Record<string, PostTableRecord>,
  unresolvedPost: PostTableRecord
): PostTableRecord => {
  const newPost = { ...unresolvedPost };
  delete newPost['resolvedStatus'];
  if (newPost.type === 'post') {
    console.log(`Resolving post ${unresolvedPost.uri}`);
    if (newPost.replyParentUri != null) {
      if (resolvedPosts[newPost.replyParentUri]) {
        const replyTo = resolvedPosts[newPost.replyParentUri];
        newPost.replyParentAuthorDid = replyTo.author;
        if (replyTo.type === 'post') {
          newPost.replyParentTextEntries = replyTo.textEntries;
        } else {
          newPost.replyParentTextEntries = [];
        }
      } else {
        newPost.resolvedStatus = 'EXTERNAL_RESOLVE';
      }
    }
    if (newPost.replyRootUri != null) {
      if (resolvedPosts[newPost.replyRootUri]) {
        const replyTo = resolvedPosts[newPost.replyRootUri];
        newPost.replyRootAuthorDid = replyTo.author;
        if (replyTo.type === 'post') {
          newPost.replyRootTextEntries = replyTo.textEntries;
        } else {
          newPost.replyRootTextEntries = [];
        }
      } else {
        newPost.resolvedStatus = 'EXTERNAL_RESOLVE';
      }
    }
  } else if (newPost.type === 'repost') {
    console.log(`Resolving repost ${unresolvedPost.uri}`);
    if (resolvedPosts[newPost.repostedPostUri] == null) {
      newPost.resolvedStatus = 'EXTERNAL_RESOLVE';
    }
  }
  return newPost;
};

type Event =
  | {
      type: 'resolve';
      record: PostTableRecord;
    }
  | { type: 'external-resolve' };

const fetchReferencedPostsLocalOrRemote = async (
  agent: BskyAgent,
  unresolvedPosts: Array<PostTableRecord>,
  expiresAt: number
): Promise<{
  loadedPosts: Record<string, PostTableRecord>;
  externalPostUris: Set<string>;
}> => {
  const urisToLoad = new Set<string>();
  unresolvedPosts.forEach((unresolvedPost) =>
    addUrisToLoad(urisToLoad, unresolvedPost)
  );
  const loadedPosts: Record<string, PostTableRecord> = {};
  const externalPostUris = new Set<string>();
  const locallyResolvedPosts = await getPosts(Array.from(urisToLoad));
  Object.assign(loadedPosts, locallyResolvedPosts);
  Object.keys(locallyResolvedPosts).forEach((uri) => urisToLoad.delete(uri));

  if (urisToLoad.size > 0) {
    const postsRespose = await agent.getPosts({
      uris: Array.from(urisToLoad),
    });
    postsRespose.data.posts.forEach((post) => {
      const record = postToPostTableRecord(
        {
          author: post.author.did,
          record: post.record as PostRecord,
          uri: post.uri,
        },
        expiresAt
      );
      loadedPosts[record.uri] = record;
      externalPostUris.add(record.uri);
    });
  }
  return { loadedPosts, externalPostUris };
};

export const rawHandler = async (event: Event): Promise<void> => {
  if (event.type === 'resolve') {
    const unresolvedPost = event.record;
    const urisToLoad = new Set<string>();
    addUrisToLoad(urisToLoad, unresolvedPost);
    const loadedPosts = await getPosts(Array.from(urisToLoad));

    const newPost = populateResolvedPost(loadedPosts, unresolvedPost);

    await savePost(newPost);
    if (newPost.resolvedStatus === 'EXTERNAL_RESOLVE') {
      console.log(`Triggering external resolve for ${unresolvedPost.uri}`);
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: process.env.EXTERNAL_RESOLVE_QUEUE_URL as string,
          MessageBody: JSON.stringify(newPost),
        })
      );
    }
  } else if (event.type === 'external-resolve') {
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const [unresolvedPosts, agent] = await Promise.all([
      getPostsForExternalResolve(12),
      getBskyAgent(),
    ]);

    const { loadedPosts, externalPostUris } =
      await fetchReferencedPostsLocalOrRemote(
        agent,
        unresolvedPosts,
        expiresAt
      );
    const repostedPostsToResolve = unresolvedPosts.flatMap((post) => {
      if (post.type === 'repost') {
        const repostedPost = loadedPosts[post.repostedPostUri];
        if (
          (repostedPost != null && repostedPost.resolvedStatus != null) ||
          repostedPost.resolvedStatus !== 'RESOLVED'
        ) {
          return [repostedPost];
        }
      }
      return [];
    });
    if (repostedPostsToResolve.length > 0) {
      const postsReferencedByRepostedPosts =
        await fetchReferencedPostsLocalOrRemote(
          agent,
          unresolvedPosts,
          expiresAt
        );
      Object.assign(loadedPosts, postsReferencedByRepostedPosts.loadedPosts);
      postsReferencedByRepostedPosts.externalPostUris.forEach((uri) =>
        externalPostUris.add(uri)
      );
      repostedPostsToResolve.forEach((unresolvedPost) => {
        const newPost = populateResolvedPost(loadedPosts, unresolvedPost);
        loadedPosts[newPost.uri] = newPost;
      });
    }
    const postsToSave: Array<PostTableRecord> = [];
    unresolvedPosts.forEach((unresolvedPost) => {
      const newPost = populateResolvedPost(loadedPosts, unresolvedPost);
      delete newPost['resolvedStatus'];
      postsToSave.push(newPost);
    });
    externalPostUris.forEach((uri) => {
      const post = loadedPosts[uri];
      if (post.resolvedStatus == null || post.resolvedStatus === 'RESOLVED') {
        postsToSave.push(post);
      }
    });
    // console.log(
    //   JSON.stringify(
    //     { externalPostUris: Array.from(externalPostUris), postsToSave },
    //     undefined,
    //     2
    //   )
    // );
    await savePostsBatch(postsToSave, []);
  }
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  const dynamodbEvent: DynamoDBStreamEvent = request.event;
  if (dynamodbEvent.Records[0].dynamodb != null) {
    request.event = {
      type: 'resolve',
      record: unmarshall(
        dynamodbEvent.Records[0].dynamodb?.NewImage as Record<
          string,
          AttributeValue
        >
      ) as PostTableRecord,
    };
    return;
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  const sqsEvent: SQSEvent = request.event;
  if (sqsEvent.Records[0].body != null) {
    request.event = { type: 'external-resolve' };
    return;
  }
});
