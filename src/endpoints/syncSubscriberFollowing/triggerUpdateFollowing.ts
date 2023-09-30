import middy from '@middy/core';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  AggregateListRecord,
  deleteAggregateListRecord,
} from '../../followingStore';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateFollowingEvent } from './updateFollowing';

const sqsClient = new SQSClient({});
let nextSendTime = 0;
const queueMessage = async (event: UpdateFollowingEvent) => {
  const now = Date.now();
  const DelaySeconds = Math.round(Math.max(0, nextSendTime - now) / 1000);
  console.log({ now, DelaySeconds });
  if (DelaySeconds > 900) {
    console.log('queueing for backoff');
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl:
          process.env.UPDATE_FOLLOWING_BACKOFF_QUEUE_URL ??
          '?? unknown queue ??',
        MessageBody: JSON.stringify(event),
        DelaySeconds: 900,
      })
    );
  } else {
    nextSendTime =
      now + (DelaySeconds + Math.round(3 * Math.random()) + 1) * 1000;
    console.log('queueing for action');
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl:
          process.env.UPDATE_FOLLOWING_QUEUE_URL ?? '?? unknown queue ??',
        MessageBody: JSON.stringify(event),
        DelaySeconds,
      })
    );
  }
};

type Event =
  | {
      type: 'initial';
      event: AggregateListRecord;
    }
  | {
      type: 'replay';
      event: UpdateFollowingEvent;
    };

export const rawHandler = async (rawEvent: Event): Promise<void> => {
  if (rawEvent.type === 'replay') {
    console.log('Replaying ' + JSON.stringify(rawEvent.event));
    await queueMessage(rawEvent.event);
    return;
  }
  const event = rawEvent.event;
  if (event.followedBy === 0) {
    console.log('Deleting: ' + JSON.stringify(event));
    let deletedRecord;
    try {
      deletedRecord = await deleteAggregateListRecord(event.qualifier);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        console.log('Followed by is no longer zero, skipping delete');
        return;
      } else {
        throw error;
      }
    }
    if (
      deletedRecord.followingEntryUri == null ||
      deletedRecord.followingEntryRid == null
    ) {
      console.log('Skipping remove list as there is no URI / RID');
    } else {
      await queueMessage({
        type: 'remove',
        userDid: deletedRecord.qualifier,
        followingEntryUri: deletedRecord.followingEntryUri,
        followingEntryRid: deletedRecord.followingEntryRid,
      });
    }
  } else {
    console.log('Adding: ' + JSON.stringify(event));
    await queueMessage({
      type: 'add',
      userDid: event.qualifier,
    });
  }
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  if (request.event.Records[0].dynamodb != null) {
    request.event = {
      type: 'initial',
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      event: unmarshall(request.event.Records[0].dynamodb?.NewImage),
    };
  } else {
    request.event = {
      type: 'replay',
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      event: JSON.parse(request.event.Records[0].body),
    };
  }
});
