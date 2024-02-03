/* eslint-disable @typescript-eslint/ban-ts-comment */
import { CreateOp } from './firehoseSubscription/subscribe';
import type { Record as PostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import type { Main as ImageEmbed } from '@atproto/api/dist/client/types/app/bsky/embed/images';
import type { Main as ExternalEmbed } from '@atproto/api/dist/client/types/app/bsky/embed/external';
import type { Main as RecordEmbed } from '@atproto/api/dist/client/types/app/bsky/embed/record';
import type { Main as RecordWithMediaEmbed } from '@atproto/api/dist/client/types/app/bsky/embed/recordWithMedia';
import { PostEntry, PostTableRecord } from '../../postsStore';

type ReplyDetails = Pick<
  PostEntry,
  | 'replyRootUri'
  | 'replyRootAuthorDid'
  | 'replyParentUri'
  | 'replyParentAuthorDid'
>;

const getAuthorFromPostUri = (postUri: string) => postUri.split('/')[2];

const buildReplyDetails = (
  post: Pick<CreateOp<PostRecord>, 'record' | 'uri' | 'author'>
): ReplyDetails => {
  const replyDetails: ReplyDetails = {};
  const replyRootUri = post.record.reply?.root?.uri;
  if (replyRootUri != null) {
    replyDetails.replyRootUri = replyRootUri;
    replyDetails.replyRootAuthorDid = getAuthorFromPostUri(replyRootUri);
  }
  const replyParentUri = post.record.reply?.parent?.uri;
  if (replyParentUri != null) {
    replyDetails.replyParentUri = replyParentUri;
    replyDetails.replyParentAuthorDid = getAuthorFromPostUri(replyParentUri);
  }
  return replyDetails;
};

const isImageEmbed = (embed: PostRecord['embed']): embed is ImageEmbed =>
  embed != null && embed['$type'] === 'app.bsky.embed.images';
const isExternalEmbed = (embed: PostRecord['embed']): embed is ExternalEmbed =>
  embed != null && embed['$type'] === 'app.bsky.embed.external';
const isRecordEmbed = (embed: PostRecord['embed']): embed is RecordEmbed =>
  embed != null && embed['$type'] === 'app.bsky.embed.record';
const isRecordWithMediaEmbed = (
  embed: PostRecord['embed']
): embed is RecordWithMediaEmbed =>
  embed != null && embed['$type'] === 'app.bsky.embed.recordWithMedia';

export const postToPostTableRecord = (
  post: Pick<CreateOp<PostRecord>, 'record' | 'uri' | 'author'>,
  expiresAt: number,
  followedBy: Record<string, true>
): PostTableRecord & { type: 'post' } => {
  const textEntries: Array<string> = [];
  let quoteDetails:
    | Pick<PostEntry, 'quotedPostUri' | 'quotedPostAuthorDid'>
    | undefined = undefined;
  if (post.record.text != null) {
    textEntries.push(post.record.text as string);
  }
  let externalDetails: Pick<PostEntry, 'externalUri'> | undefined = undefined;
  const embed = post.record.embed;
  if (isImageEmbed(embed)) {
    embed.images.forEach((image) => {
      if (image.alt) {
        textEntries.push(image.alt);
      }
    });
  }
  if (isExternalEmbed(embed)) {
    textEntries.push(embed.external.description);
    externalDetails = { externalUri: embed.external.uri };
  }
  if (isRecordEmbed(embed)) {
    quoteDetails = {
      quotedPostUri: embed.record.uri,
      quotedPostAuthorDid: getAuthorFromPostUri(embed.record.uri),
    };
  }
  if (isRecordWithMediaEmbed(embed)) {
    quoteDetails = {
      quotedPostUri: embed.record.record.uri,
      quotedPostAuthorDid: getAuthorFromPostUri(embed.record.record.uri),
    };
    const media = embed.media;
    if (isImageEmbed(media)) {
      media.images.forEach((image) => {
        if (image.alt) {
          textEntries.push(image.alt);
        }
      });
    }
    if (isExternalEmbed(media)) {
      textEntries.push(media.external.description);
    }
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
    ...externalDetails,
    ...quoteDetails,
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
