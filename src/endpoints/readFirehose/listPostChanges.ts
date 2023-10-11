import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Record as PostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import type { Record as RepostRecord } from '@atproto/api/dist/client/types/app/bsky/feed/repost';
import {
  CreateOp,
  DeleteOp,
  OperationsSubscription,
} from './firehoseSubscription/subscribe';

type FirehoseCursor = {
  cursor: number;
  time: string;
};

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);
const AppStatusTable = process.env.APP_STATUS_TABLE as string;

export async function* listPostChanges(opts: {
  maxReadTimeMillis: number;
}): AsyncGenerator<CreateOp<PostRecord | RepostRecord> | DeleteOp> {
  let cursor = await ddbDocClient
    .send(
      new GetCommand({
        TableName: AppStatusTable,
        Key: {
          setting: 'firehose-cursor',
        },
      })
    )
    .then((result) => result.Item as FirehoseCursor | undefined);
  const start = new Date();
  const startISOString = start.toISOString();
  console.log({ cursor });
  if (
    cursor != null &&
    cursor.time < new Date(Date.now() - 4 * 60 * 60000).toISOString()
  ) {
    // Saftey check, if the cursor is more than 4 hours old we're probably better to stop
    // trying to drop bleets than try to catch up
    console.log('Ignoring cursor as it is more than 4 hours old');
    cursor = undefined;
  }
  const controller = new AbortController();
  const subscription = new OperationsSubscription({
    cursor: cursor?.cursor,
    signal: controller.signal,
  });
  let lastSeq: number | undefined = undefined;
  let lastTime: string | undefined = undefined;
  const maxReadTimeTimeout = setTimeout(() => {
    // Abort the subscription after the maximum read time so that we don't wait and get a lambda timeout
    console.log('max read time abort');
    controller.abort();
  }, opts.maxReadTimeMillis);
  let maxItemTimeTimeout = setTimeout(() => {
    console.log('initial max idle time abort');
    controller.abort();
  }, 1000);
  try {
    for await (const evt of subscription) {
      clearTimeout(maxItemTimeTimeout);
      lastSeq = evt.seq;
      lastTime = evt.time;

      for (const post of [...evt.posts.creates, ...evt.reposts.creates]) {
        yield post;
      }
      for (const del of [...evt.posts.deletes, ...evt.reposts.deletes]) {
        yield del;
      }
      // if we've caught up to the time we started then exit the loop, we'll get more next poll
      // This behaviour means we're reading messages at full speed from the firehose
      // rather than waiting for new bleets to be made
      if (evt.time > startISOString) {
        break;
      }
      maxItemTimeTimeout = setTimeout(() => {
        console.log('max idle time abort');
        controller.abort();
      }, 500);
    }
  } catch (error) {
    // Ignore errors when we aborted to trigger the closing of the connection
    if (!controller.signal.aborted) {
      throw error;
    }
  } finally {
    clearTimeout(maxReadTimeTimeout);
    clearTimeout(maxItemTimeTimeout);
  }

  if (lastSeq != null && lastTime != null) {
    const updatedCursor: FirehoseCursor = {
      cursor: lastSeq,
      time: lastTime,
    };
    console.log({ updatedCursor });
    await ddbDocClient.send(
      new PutCommand({
        TableName: AppStatusTable,
        Item: {
          setting: 'firehose-cursor',
          ...updatedCursor,
        },
      })
    );
  }
}
