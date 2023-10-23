import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { PostTableRecord, addToFeeds, removeFromFeeds } from '../../postsStore';
import { listFollowedBy } from '../../followingStore';
import { DynamoDBStreamEvent } from 'aws-lambda';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { MuteWordsOperation, updateMuteWords } from '../../muteWordsStore';

type Event =
  | {
      eventName: 'INSERT';
      record: PostTableRecord;
    }
  | { eventName: 'REMOVE'; key: Pick<PostTableRecord, 'uri'> };

const handleCommands = async (post: PostTableRecord) => {
  if (post.type !== 'post') return;
  if (!post.startsWithMention) return;
  if (
    !post.mentionedDids.some(
      (did) => did === process.env.BLUESKY_SERVICE_USER_DID
    )
  )
    return;
  if (post.textEntries.length < 1) return;

  const text = post.textEntries[0].toLowerCase();

  const match = text.match(
    new RegExp(
      `@${process.env.BLUESKY_SERVICE_IDENTIFIER}\\s+(mute|unmute)\\s+(.+)`
    )
  );
  if (match == null) {
    return;
  }
  const operations: Array<MuteWordsOperation> = [];
  const operation = match[1];
  match[2]
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => Boolean(word))
    .forEach((word) =>
      operations.push({
        operation: operation as 'mute' | 'unmute',
        subscriberDid: post.author,
        word,
      })
    );

  const seenWords = new Set<string>();
  const finalOperations = operations
    .filter(({ subscriberDid, word }) => {
      const key = `${subscriberDid}--${word}`;
      const mostRecent = !seenWords.has(key);
      seenWords.add(key);
      return mostRecent;
    })
    .reverse();

  console.log(JSON.stringify({ operations, finalOperations }, undefined, 2));
  await updateMuteWords(finalOperations);
};

export const rawHandler = async (event: Event): Promise<void> => {
  return;
  if (event.eventName === 'INSERT') {
    await Promise.all([
      (async () => {
        const followedBy = await listFollowedBy(event.record.author);
        await addToFeeds(event.record, followedBy);
      })(),
      handleCommands(event.record),
    ]);
  } else if (event.eventName === 'REMOVE') {
    await removeFromFeeds(event.key.uri);
  }
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  const event: DynamoDBStreamEvent = request.event;
  if (event.Records[0].eventName === 'INSERT') {
    request.event = {
      eventName: 'INSERT',
      record: unmarshall(
        event.Records[0].dynamodb?.NewImage as Record<string, AttributeValue>
      ) as PostTableRecord,
    };
  } else if (event.Records[0].eventName === 'REMOVE') {
    request.event = {
      eventName: 'REMOVE',
      key: unmarshall(
        event.Records[0].dynamodb?.Keys as Record<string, AttributeValue>
      ) as Pick<PostTableRecord, 'uri'>,
    };
  } else {
    console.log(`Unable to process event ${JSON.stringify(event)}`);
    return 'NoOp';
  }
});
