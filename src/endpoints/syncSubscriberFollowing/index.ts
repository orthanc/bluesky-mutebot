import { DynamoDBStreamEvent } from 'aws-lambda';
import middy from '@middy/core';

export const rawHandler = async (event: DynamoDBStreamEvent): Promise<void> => {
  console.log(JSON.stringify(event, undefined, 2));
};

export const handler = middy(rawHandler);
