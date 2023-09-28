import { BskyAgent } from '@atproto/api';
import { getBskyAgent } from '../../bluesky';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);

async function* listNotifications(agent: BskyAgent, lastSeen = '0') {
  let cursor: string | undefined = undefined;
  let returnedAny = false;
  do {
    const response = await agent.app.bsky.notification.listNotifications({
      limit: 100,
      cursor,
    });
    cursor = response.data.cursor;
    returnedAny = false;
    for (const notification of response.data.notifications) {
      if (notification.indexedAt > lastSeen) {
        returnedAny = true;
        yield notification;
      }
    }
  } while (cursor != null && returnedAny);
}

export const handler = async (): Promise<void> => {
  const TableName = process.env.MUTE_WORDS_TABLE as string;
  const [agent, lastSeen] = await Promise.all([
    getBskyAgent(),
    ddbDocClient
      .send(
        new GetCommand({
          TableName,
          Key: {
            subscriberDid: 'syncState',
            muteWord: 'notification',
          },
        })
      )
      .then((result) => result.Item?.lastSeen as string | undefined),
  ]);

  let latestDate: string | undefined = undefined;
  const operations: Array<{
    operation: 'mute' | 'unmute';
    subscriberDid: string;
    word: string;
  }> = [];
  for await (const notification of listNotifications(agent, lastSeen)) {
    if (latestDate == null || latestDate < notification.indexedAt) {
      latestDate = notification.indexedAt;
    }
    if (notification.reason !== 'mention') {
      continue;
    }
    const subscriberDid = notification.author.did;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const text: string = notification.record.text.toLowerCase();

    const match = text.match(
      new RegExp(
        `@${process.env.BLUESKY_SERVICE_IDENTIFIER}\\s+(mute|unmute)\\s+(.+)`
      )
    );
    if (match == null) {
      continue;
    }
    const operation = match[1];
    match[2]
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => Boolean(word))
      .forEach((word) =>
        operations.push({
          operation: operation as 'mute' | 'unmute',
          subscriberDid,
          word,
        })
      );
  }

  const seenWords = new Set<string>();
  const finalOperations = operations
    .filter(({ subscriberDid, word }) => {
      const key = `${subscriberDid}--${word}`;
      const mostRecent = !seenWords.has(key);
      seenWords.add(key);
      return mostRecent;
    })
    .reverse();

  console.log(
    JSON.stringify({ operations, finalOperations, latestDate }, undefined, 2)
  );
  let remainingOperations = finalOperations;
  while (remainingOperations.length > 0) {
    const batch = remainingOperations.slice(0, 100);
    remainingOperations = remainingOperations.slice(100);
    const writeCommand: TransactWriteCommandInput = {
      TransactItems: batch.map((operation) =>
        operation.operation === 'mute'
          ? {
              Put: {
                TableName,
                Item: {
                  subscriberDid: operation.subscriberDid,
                  muteWord: operation.word,
                },
              },
            }
          : {
              Delete: {
                TableName,
                Key: {
                  subscriberDid: operation.subscriberDid,
                  muteWord: operation.word,
                },
              },
            }
      ),
    };
    console.log(JSON.stringify(writeCommand, undefined, 2));
    await ddbDocClient.send(new TransactWriteCommand(writeCommand));
  }

  if (latestDate != null) {
    await ddbDocClient.send(
      new PutCommand({
        TableName,
        Item: {
          subscriberDid: 'syncState',
          muteWord: 'notification',
          lastSeen: latestDate,
        },
      })
    );
    await agent.app.bsky.notification.updateSeen({
      seenAt: latestDate,
    });
  }
};
