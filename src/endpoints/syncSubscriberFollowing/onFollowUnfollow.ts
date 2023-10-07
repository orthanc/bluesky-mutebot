import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  AggregateListRecord,
  markAggregateListRecordForDeletion,
} from '../../followingStore';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

export const rawHandler = async (event: AggregateListRecord): Promise<void> => {
  if (event.followedBy === 0) {
    console.log('Marking for delete: ' + JSON.stringify(event));
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    try {
      await markAggregateListRecordForDeletion(event.qualifier, expiresAt);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        console.log('Followed by is no longer zero, skipping mark for delete');
        return;
      } else {
        throw error;
      }
    }
  } else {
    console.log('Adding: ' + JSON.stringify(event));
  }
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  request.event = unmarshall(request.event.Records[0].dynamodb?.NewImage);
});
