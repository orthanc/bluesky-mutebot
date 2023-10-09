import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { PostTableRecord, getPosts, savePost } from '../../postsStore';
import { DynamoDBStreamEvent } from 'aws-lambda';
import { AttributeValue } from '@aws-sdk/client-dynamodb';

export const rawHandler = async (
  unresolvedPost: PostTableRecord
): Promise<void> => {
  const postsToResolve = new Set<string>();
  if (unresolvedPost.type === 'post') {
    if (
      unresolvedPost.replyParentUri != null &&
      unresolvedPost.replyParentAuthorDid == null
    ) {
      postsToResolve.add(unresolvedPost.replyParentUri);
    }
    if (
      unresolvedPost.replyRootUri != null &&
      unresolvedPost.replyRootAuthorDid == null
    ) {
      postsToResolve.add(unresolvedPost.replyRootUri);
    }
  } else if (unresolvedPost.type === 'repost') {
    if (unresolvedPost.post == null) {
      postsToResolve.add(unresolvedPost.repostedPostUri);
    }
  }
  const resolvedPosts = await getPosts(Array.from(postsToResolve));

  const newPost = { ...unresolvedPost };
  delete newPost['resolvedStatus'];
  if (newPost.type === 'post') {
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
    if (resolvedPosts[newPost.repostedPostUri]) {
      const repostedPost = resolvedPosts[newPost.repostedPostUri];
      if (repostedPost.type === 'post') {
        newPost.post = repostedPost;
      }
    } else {
      newPost.resolvedStatus = 'EXTERNAL_RESOLVE';
    }
  }

  await savePost(newPost);
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  const event: DynamoDBStreamEvent = request.event;
  request.event = unmarshall(
    event.Records[0].dynamodb?.NewImage as Record<string, AttributeValue>
  ) as PostTableRecord;
});
