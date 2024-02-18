import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { followAuthorsPosts } from '../../postsStore';

type Event =
  | { eventName: 'add-follow'; followingDid: string; subscriberDid: string }
  | { eventName: 'remove-follow'; followingDid: string; subscriberDid: string };

export const rawHandler = async (event: Event): Promise<void> => {
  if (event.eventName === 'add-follow') {
    console.log(event);
    await followAuthorsPosts(event.subscriberDid, event.followingDid);
  } else if (event.eventName === 'remove-follow') {
    console.log(event);
  }
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  const event: DynamoDBStreamEvent = request.event;
  if (
    event.Records[0].eventName === 'INSERT' ||
    event.Records[0].eventName === 'MODIFY'
  ) {
    const record = unmarshall(
      event.Records[0].dynamodb?.NewImage as Record<string, AttributeValue>
    ) as { qualifier: string; subscriberDid: string };
    if (
      event.Records[0].eventName === 'INSERT' &&
      record.qualifier !== 'subscriber'
    ) {
      request.event = {
        eventName: 'add-follow',
        subscriberDid: record.qualifier,
        followingDid: record.subscriberDid,
      };
      return;
    }
  } else if (event.Records[0].eventName === 'REMOVE') {
    const key = unmarshall(
      event.Records[0].dynamodb?.Keys as Record<string, AttributeValue>
    ) as { qualifier: string; subscriberDid: string };
    request.event = {
      eventName: 'remove-follow',
      subscriberDid: key.qualifier,
      followingDid: key.subscriberDid,
    };
  } else {
    console.log(`Unable to process event ${JSON.stringify(event)}`);
    return 'NoOp';
  }
});
