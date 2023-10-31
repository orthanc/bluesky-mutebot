import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import httpError from 'http-errors';
import { render } from 'preact-render-to-string';
import { Page } from './Page';
import { createSession, getSessionBySessionId } from '../sessionStore';
import { generateAuthToken, validateAuthToken } from '../../../authTokens';
import { EstablishingSession } from './EstablishingSession';
import { BleetToAuthorise } from './BleetToAuthorise';
import { MuteWordsContent } from './MuteWordsContent';
import { getMuteWords } from '../../../muteWordsStore';
import cookie from 'cookie';
import { Login } from './Login';

export type WebEvent = APIGatewayProxyEventV2;
const processLoginRequest = async (
  event: WebEvent
): Promise<{
  node?: preact.VNode;
  headers?: APIGatewayProxyStructuredResultV2['headers'];
}> => {
  switch (event.routeKey) {
    case 'POST /login/session': {
      const session = await createSession();
      const authToken = await generateAuthToken(
        'access-token-signing-key',
        session.sessionId,
        '15 minutes',
        'login'
      );
      return {
        node: <EstablishingSession />,
        headers: {
          'HX-Trigger': JSON.stringify({
            'mutebot:auth-token-issued': authToken,
          }),
        },
      };
    }
  }
  const authHeader = event.headers.authorization;
  const authToken = authHeader?.replace(/^Bearer /, '').trim();
  if (authToken == null) {
    throw new httpError.Unauthorized('No Auth Token');
  }
  const { sessionId } = await validateAuthToken(
    'access-token-signing-key',
    authToken
  );
  const session = await getSessionBySessionId(sessionId);
  if (session == null) {
    throw new httpError.Unauthorized('Unknown Session');
  }

  if (session.status === 'pending') {
    switch (event.routeKey) {
      case 'GET /login/session/auth-code': {
        if (session.authKey == null) {
          return {};
        } else {
          return { node: <BleetToAuthorise authKey={session.authKey} /> };
        }
      }
      case 'GET /login/session/approval':
        return {};
      default:
        throw new httpError.Unauthorized(`Session is pending`);
    }
  } else {
    switch (event.routeKey) {
      case 'GET /login/session/auth-code':
      case 'GET /login/session/approval': {
        const authToken = await generateAuthToken(
          'access-token-signing-key',
          session.sessionId,
          '1 hour',
          'session'
        );
        const muteWords = await getMuteWords(session.subscriberDid);

        return {
          node: (
            <MuteWordsContent
              handle={session.subscriberHandle}
              muteWords={muteWords}
            />
          ),
          headers: {
            'HX-Trigger': JSON.stringify({
              'mutebot:auth-token-issued': authToken,
            }),
            'Set-Cookie': cookie.serialize('mutebot-session', authToken, {
              httpOnly: true,
              maxAge: 3600,
              path: '/',
              sameSite: 'strict',
            }),
          },
        };
      }
    }
  }

  throw new httpError.NotFound(`No route for ${event.routeKey}`);
};

const createHttpResponse = ({
  node,
  headers,
  wholePage,
}: {
  node?: preact.VNode;
  headers?: APIGatewayProxyStructuredResultV2['headers'];
  wholePage?: boolean;
}): APIGatewayProxyResultV2 => ({
  statusCode: node == null ? 204 : 200,
  headers: {
    'Content-Type': 'text/html',
    ...headers,
  },
  body:
    node == null
      ? undefined
      : (wholePage ? '<!DOCTYPE html>' : '') + render(node),
});

export const renderPage = async (
  event: WebEvent
): Promise<APIGatewayProxyResultV2> => {
  console.log(JSON.stringify(event, undefined, 2));
  const method = event.requestContext.http.method;
  if (event.rawPath.startsWith('/login')) {
    const response = await processLoginRequest(event);
    return createHttpResponse(response);
  } else if (method === 'GET' || method === 'OPTIONS') {
    const cookieHeader = event.headers.cookie;
    if (cookieHeader != null) {
      const a = cookie.parse(cookieHeader);
      console.log(a);
    }
  } else {
  }
  return createHttpResponse({
    node: (
      <Page>
        <Login />
      </Page>
    ),
    wholePage: true,

    headers: {
      'Set-Cookie': cookie.serialize('mutebot-test', 'test', {
        httpOnly: true,
        maxAge: 3600,
        path: '/',
      }),
    },
  });
  throw new httpError.NotFound(`No route for ${event.routeKey}`);
};
