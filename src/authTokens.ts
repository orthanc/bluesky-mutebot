import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import base64url from 'base64url';
import httpErrors from 'http-errors';
import {
  GetParameterCommand,
  GetParametersByPathCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

const deployStage = process.env.DEPLOY_STAGE ?? '';
const tokenIssuer = `login-${deployStage}`;

export type JwkKey = {
  kid: string;
  kty: string;
  use: string;
  key_ops: Array<string>;
  alg: string;
  k: string;
};

const ssmClient = new SSMClient({});

export const generateAuthToken = async (
  keyName: string,
  sessionId: string,
  expiresIn: string
): Promise<string> => {
  const tokenAudience = `${keyName.split('-')[0]}-${deployStage}`;
  const parameter = await ssmClient.send(
    new GetParameterCommand({
      Name: `/bluesky-feeds/${deployStage}/${keyName}/current`,
      WithDecryption: true,
    })
  );

  if (parameter.Parameter == null || parameter.Parameter.Value == null) {
    console.error(
      `No value for bluesky-feeds/${deployStage}/${keyName}/current`
    );
    throw new httpErrors.ServiceUnavailable('Cannot Issue Auth Token');
  }

  const key = JSON.parse(parameter.Parameter.Value) as JwkKey;
  const keyBytes = Buffer.from(base64url.decode(key.k));

  return jwt.sign({}, keyBytes, {
    subject: sessionId,
    audience: tokenAudience,
    issuer: tokenIssuer,
    algorithm: 'HS256',
    expiresIn,
    jwtid: uuidv4(),
    keyid: key.kid,
  });
};

export const validateAuthToken = async (
  keyName: string,
  authToken: string
): Promise<{ sessionId: string; expiresAt: number }> => {
  const tokenAudience = `${keyName.split('-')[0]}-${deployStage}`;
  const parametersResult = await ssmClient.send(
    new GetParametersByPathCommand({
      Path: `/bluesky-feeds/${deployStage}/${keyName}/`,
      WithDecryption: true,
    })
  );

  const keys = (parametersResult.Parameters ?? []).reduce<
    Record<string, JwkKey>
  >((acc, parameter) => {
    if (parameter == null || parameter.Value == null) {
      return acc;
    }

    const key = JSON.parse(parameter.Value) as JwkKey;
    acc[key.kid] = key;
    return acc;
  }, {});

  const decodedToken = await new Promise((resolve, reject) =>
    jwt.verify(
      authToken,
      (header, callback) =>
        process.nextTick(() => {
          const kid = header.kid;
          const keyBytesEncoded = kid && keys[kid] && keys[kid].k;
          if (!keyBytesEncoded) {
            return callback(new Error('No Key Found'));
          }
          const bytes = Buffer.from(base64url.decode(keyBytesEncoded));
          callback(null, bytes);
        }),
      {
        issuer: tokenIssuer,
        audience: tokenAudience,
      },
      (err, decoded) => {
        if (err) {
          console.warn(`Error Validating Token: ${err}`, err);
          return reject(new httpErrors.Unauthorized('Invalid Token'));
        }
        resolve(decoded);
      }
    )
  );

  if (typeof decodedToken === 'object' && decodedToken != null) {
    const { sub, exp } = decodedToken as {
      sub?: string;
      screen_name?: string;
      admin?: boolean;
      exp: number;
    };
    if (typeof sub === 'string') {
      return {
        sessionId: sub,
        expiresAt: exp,
      };
    }
  }
  console.warn(`Missing subject in token ${JSON.stringify(decodedToken)}`);
  throw new httpErrors.Unauthorized('Invalid Token');
};
