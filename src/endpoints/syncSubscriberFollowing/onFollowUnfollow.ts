import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  AggregateListRecord,
  markAggregateListRecordForDeletion,
} from '../../followingStore';
import {
  AttributeValue,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import {
  addAuthorToFeed,
  followAuthorsPosts,
  removeAuthorFromFeed,
} from '../../postsStore';

type Event =
  | {
      eventName: 'aggregate-change';
      record: AggregateListRecord;
    }
  | { eventName: 'add-follow'; followingDid: string; subscriberDid: string }
  | { eventName: 'remove-follow'; followingDid: string; subscriberDid: string };

export const rawHandler = async (event: Event): Promise<void> => {
  if (event.eventName === 'aggregate-change') {
    if (event.record.followedBy === 0) {
      console.log('Marking for delete: ' + JSON.stringify(event));
      const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
      try {
        await markAggregateListRecordForDeletion(
          event.record.qualifier,
          expiresAt
        );
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          console.log(
            'Followed by is no longer zero, skipping mark for delete'
          );
          return;
        } else {
          throw error;
        }
      }
    } else {
      console.log('Adding: ' + JSON.stringify(event));
    }
  } else if (event.eventName === 'add-follow') {
    console.log(event);
    // await addAuthorToFeed(event.subscriberDid, event.followingDid);
    await followAuthorsPosts(event.subscriberDid, event.followingDid);
  } else if (event.eventName === 'remove-follow') {
    console.log(event);
    // This can get really expensive when a person is removed as we essentially clear 7 days of posts
    // rather than just letting them time out. So for now don't do that
    // await removeAuthorFromFeed(event.subscriberDid, event.followingDid);
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
    ) as AggregateListRecord;
    if (record.subscriberDid === 'aggregate') {
      request.event = {
        eventName: 'aggregate-change',
        record,
      };
      return;
    } else if (
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
    ) as Pick<AggregateListRecord, 'subscriberDid' | 'qualifier'>;
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
