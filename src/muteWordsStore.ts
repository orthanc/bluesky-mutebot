import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  QueryCommandOutput,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export type MuteWordsOperation = {
  operation: 'mute' | 'unmute';
  subscriberDid: string;
  word: string;
};

export const getMuteWords = async (
  subscriberDid: string
): Promise<Array<string>> => {
  const TableName = process.env.MUTE_WORDS_TABLE as string;
  let ExclusiveStartKey: Record<string, string> | undefined = undefined;
  const muteWords: Array<string> = [];
  do {
    const result: QueryCommandOutput = await ddbDocClient.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: 'subscriberDid = :subscriberDid',
        ExpressionAttributeValues: {
          ':subscriberDid': subscriberDid,
        },
        ExclusiveStartKey,
      })
    );
    (ExclusiveStartKey = result.LastEvaluatedKey),
      result.Items?.map(({ muteWord }) => muteWords.push(muteWord));
  } while (ExclusiveStartKey != null);
  return muteWords;
};

export const deleteMuteWord = async (
  subscriberDid: string,
  muteWord: string
) => {
  const TableName = process.env.MUTE_WORDS_TABLE as string;
  await ddbDocClient.send(
    new DeleteCommand({
      TableName,
      Key: {
        subscriberDid,
        muteWord,
      },
    })
  );
};

export const addMuteWord = async (subscriberDid: string, muteWord: string) => {
  const TableName = process.env.MUTE_WORDS_TABLE as string;
  await ddbDocClient.send(
    new PutCommand({
      TableName,
      Item: {
        subscriberDid,
        muteWord: muteWord.toLowerCase().trim(),
      },
    })
  );
};

export const updateMuteWords = async (
  operations: Array<MuteWordsOperation>
) => {
  const TableName = process.env.MUTE_WORDS_TABLE as string;
  let remainingOperations = operations;
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
    await ddbDocClient.send(new TransactWriteCommand(writeCommand));
  }
};
