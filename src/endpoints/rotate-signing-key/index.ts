import {
  GetParameterCommand,
  ParameterNotFound,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';
import { GenerateRandomCommand, KMSClient } from '@aws-sdk/client-kms';
import base64url from 'base64url';
import { v4 as uuidv4 } from 'uuid';
import { JwkKey } from '../../authTokens';

const ssmClient = new SSMClient({});
const kmsClient = new KMSClient({});

export const handler = async ({
  keyName,
}: {
  keyName: string;
}): Promise<void> => {
  const deployStage = process.env.DEPLOY_STAGE ?? '';
  const currentKeyName = `/bluesky-feeds/${deployStage}/${keyName}/current`;
  const previousKeyName = `/bluesky-feeds/${deployStage}/${keyName}/previous`;

  console.log({
    keyName,
    currentKeyName,
    previousKeyName,
  });

  try {
    const currentKey = await ssmClient.send(
      new GetParameterCommand({
        Name: currentKeyName,
        WithDecryption: true,
      })
    );

    if (currentKey.Parameter != null && currentKey.Parameter.Value != null) {
      await ssmClient.send(
        new PutParameterCommand({
          Name: previousKeyName,
          Value: currentKey.Parameter.Value,
          Type: 'SecureString',
          Overwrite: true,
        })
      );
    }
  } catch (error) {
    if (error instanceof ParameterNotFound) {
      console.log(`Current key ${currentKeyName} doesn't exist`);
    } else {
      throw error;
    }
  }

  const randomResult = await kmsClient.send(
    new GenerateRandomCommand({
      NumberOfBytes: 32,
    })
  );

  if (randomResult.Plaintext == null)
    throw new Error('Unable to generate session id');
  const signingKey = base64url.encode(Buffer.from(randomResult.Plaintext));

  const key: JwkKey = {
    kid: uuidv4(),
    kty: 'oct',
    use: 'sig',
    key_ops: ['sign', 'verify'],
    alg: 'HS256',
    k: signingKey,
  };

  await ssmClient.send(
    new PutParameterCommand({
      Name: currentKeyName,
      Value: JSON.stringify(key),
      Type: 'SecureString',
      Overwrite: true,
    })
  );
};
