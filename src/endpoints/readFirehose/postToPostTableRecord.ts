/* eslint-disable @typescript-eslint/ban-ts-comment */
import { CreateOp } from './firehoseSubscription/subscribe';
import type { Record as PostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import { PostTableRecord } from '../../postsStore';

type ReplyDetails = {
  replyRootUri?: string;
  replyRootAuthorDid?: string;
  replyParentUri?: string;
  replyParentAuthorDid?: string;
};

const buildReplyDetails = (
  post: Pick<CreateOp<PostRecord>, 'record' | 'uri' | 'author'>
): ReplyDetails => {
  const replyDetails: ReplyDetails = {};
  const replyRootUri = post.record.reply?.root?.uri;
  if (replyRootUri != null) {
    const replyRootAuthorDid = replyRootUri.split('/')[2];
    replyDetails.replyRootUri = replyRootUri;
    replyDetails.replyRootAuthorDid = replyRootAuthorDid;
  }
  const replyParentUri = post.record.reply?.parent?.uri;
  if (replyParentUri != null) {
    const replyParentAuthorDid = replyParentUri.split('/')[2];
    replyDetails.replyParentUri = replyParentUri;
    replyDetails.replyParentAuthorDid = replyParentAuthorDid;
  }
  return replyDetails;
};

export const postToPostTableRecord = (
  post: Pick<CreateOp<PostRecord>, 'record' | 'uri' | 'author'>,
  expiresAt: number,
  followedBy: Record<string, true>
): PostTableRecord & { type: 'post' } => {
  const textEntries: Array<string> = [];
  if (post.record.text != null) {
    textEntries.push(post.record.text as string);
  }
  if (post.record.embed?.images != null) {
    // @ts-expect-error
    post.record.embed.images.forEach((image) => {
      if (image.alt) {
        textEntries.push(image.alt);
      }
    });
  }
  const isReply = post.record.reply != null;
  let startsWithMention = false;
  const mentionedDids: Array<string> = [];
  if (post.record.facets != null) {
    post.record.facets.forEach((facet) => {
      if (facet.features != null) {
        facet.features.forEach((feature) => {
          if (feature['$type'] === 'app.bsky.richtext.facet#mention') {
            mentionedDids.push(feature.did as string);
            if (facet.index?.byteStart === 0) {
              startsWithMention = true;
            }
          }
        });
      }
    });
  }
  return {
    uri: post.uri,
    createdAt: post.record.createdAt,
    author: post.author,
    type: 'post',
    expiresAt,
    ...(isReply
      ? {
          resolvedStatus: 'RESOLVED',
          // resolvedStatus: 'UNRESOLVED',
          isReply,
          ...buildReplyDetails(post),
        }
      : { resolvedStatus: 'RESOLVED' }),
    ...(startsWithMention ? { startsWithMention } : undefined),
    mentionedDids,
    textEntries,
    followedBy,
  };
};
