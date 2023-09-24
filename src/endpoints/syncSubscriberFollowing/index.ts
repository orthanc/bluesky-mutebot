import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';

export const rawHandler = async (event: unknown): Promise<void> => {
  console.log(JSON.stringify(event, undefined, 2));
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  request.event = unmarshall(request.event.Records[0].dynamodb?.NewImage);
});
