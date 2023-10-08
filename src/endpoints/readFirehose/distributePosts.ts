import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { PostTableRecord, addToFeeds, removeFromFeeds } from '../../postsStore';
import { listFollowedBy } from '../../followingStore';
import { DynamoDBStreamEvent } from 'aws-lambda';
import { AttributeValue } from '@aws-sdk/client-dynamodb';

type Event =
  | {
      eventName: 'INSERT';
      record: PostTableRecord;
    }
  | { eventName: 'REMOVE'; key: Pick<PostTableRecord, 'uri'> };
export const rawHandler = async (event: Event): Promise<void> => {
  if (event.eventName === 'INSERT') {
    const followedBy = await listFollowedBy(event.record.author);

    await addToFeeds(event.record, followedBy);
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
