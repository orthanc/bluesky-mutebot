import middy from '@middy/core';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  AggregateListRecord,
  deleteAggregateListRecord,
} from '../../followingStore';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateListEvent } from './updateList';

const sqsClient = new SQSClient({});
let nextSendTime = 0;
const queueMessage = async (event: UpdateListEvent) => {
  const now = Date.now();
  const DelaySeconds = Math.round(Math.max(0, nextSendTime - now) / 1000);
  nextSendTime = now + (DelaySeconds + Math.round(Math.random() * 60)) * 1000;
  console.log({ now, DelaySeconds, nextSendTime });
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: process.env.UPDATE_LIST_QUEUE_URL ?? '?? unknown queue ??',
      MessageBody: JSON.stringify(event),
      DelaySeconds,
    })
  );
};

export const rawHandler = async (event: AggregateListRecord): Promise<void> => {
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
      deletedRecord.listItemUri == null ||
      deletedRecord.listItemRid == null
    ) {
      console.log('Skipping remove list as there is no URI / RID');
    } else {
      await queueMessage({
        type: 'remove',
        userDid: deletedRecord.qualifier,
        listItemUri: deletedRecord.listItemUri,
        listItemRid: deletedRecord.listItemRid,
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
  request.event = unmarshall(request.event.Records[0].dynamodb?.NewImage);
});
