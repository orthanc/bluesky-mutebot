import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AggregateListRecord } from '../../followingStore';

export const rawHandler = async (event: AggregateListRecord): Promise<void> => {
  console.log(JSON.stringify(event));
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  request.event = unmarshall(request.event.Records[0].dynamodb?.NewImage);
});
