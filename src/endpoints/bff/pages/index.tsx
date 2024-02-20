import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import httpError from 'http-errors';
import { render } from 'preact-render-to-string';
import { Page } from './Page';
import {
  AuthorizedSessionRecord,
  SessionRecord,
  createSession,
  getSessionBySessionId,
} from '../sessionStore';
import { generateAuthToken, validateAuthToken } from '../../../authTokens';
import { EstablishingSession } from './EstablishingSession';
import { BleetToAuthorise } from './BleetToAuthorise';
import { MuteWordsContent } from './MuteWordsContent';
import {
  addMuteWord,
  deleteMuteWord,
  getMuteWords,
} from '../../../muteWordsStore';
import cookie from 'cookie';
import { Login } from './Login';
import { Body } from './Body';
import { Content } from './Content';
import { AddMuteWord, MuteWord, MuteWordListItem } from './MuteWords.';
import { addDays, addHours, addMonths, addWeeks, addYears } from 'date-fns';

export type WebEvent = APIGatewayProxyEventV2;

type ResponseFragment = {
  node?: preact.VNode;
  headers?: APIGatewayProxyStructuredResultV2['headers'];
};

const getPossiblyPendingSession = async (
  event: WebEvent,
  options: {
    validateCSRF?: boolean;
  }
): Promise<{ session?: SessionRecord; csrfToken?: string }> => {
  const { validateCSRF = true } = options;
  const sessionCookie = event.cookies
    ?.find((cookie) => cookie.startsWith('mutebot-session='))
    ?.substring('mutebot-session='.length);
  if (sessionCookie == null) {
    return {};
  }
  const { sessionId, csrfToken } = await validateAuthToken(
    'access-token-signing-key',
    sessionCookie
  );
  if (validateCSRF) {
    if (csrfToken !== event.headers['x-csrf-token']) {
      throw new httpError.Forbidden('Invalid CSRF Token');
    }
  }
  const session = await getSessionBySessionId(sessionId);
  return { session, csrfToken };
};

const getAuthorizedSession = async (
  event: WebEvent,
  options: {
    validateCSRF?: boolean;
  }
): Promise<{ session?: AuthorizedSessionRecord; csrfToken?: string }> => {
  const { session, ...rest } = await getPossiblyPendingSession(event, options);
  if (session?.status === 'authorized') {
    return { session, ...rest };
  }
  return rest;
};

const renderPage = async (
  path: string,
  session: AuthorizedSessionRecord
): Promise<ResponseFragment> => {
  switch (path) {
    case '/': {
      const muteWords = await getMuteWords(session.subscriberDid);
      return {
        node: (
          <MuteWordsContent
            handle={session.subscriberHandle}
            muteWords={muteWords}
            now={new Date().toISOString()}
          />
        ),
      };
    }
  }
  throw new httpError.NotFound(`No route for GET ${path}`);
};

const processLoginRequest = async (
  event: WebEvent
): Promise<ResponseFragment> => {
  switch (event.routeKey) {
    case 'POST /login/session': {
      const session = await createSession();
      const { authToken, csrfToken } = await generateAuthToken(
        'access-token-signing-key',
        session.sessionId,
        '15 minutes',
        'login'
      );
      return {
        node: <EstablishingSession />,
        headers: {
          'HX-Trigger': JSON.stringify({
            'mutebot:csrf-token-issued': csrfToken,
          }),
          'Set-Cookie': cookie.serialize('mutebot-session', authToken, {
            httpOnly: true,
            maxAge: 900,
            path: '/',
            sameSite: 'strict',
          }),
        },
      };
    }
  }

  const { session } = await getPossiblyPendingSession(event, {
    validateCSRF: false,
  });
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
        const { authToken, csrfToken } = await generateAuthToken(
          'access-token-signing-key',
          session.sessionId,
          '1 hour',
          'session'
        );

        const url = new URL(event.headers['hx-current-url'] as string);
        const { node, headers } = await renderPage(url.pathname, session);

        return {
          node: (
            <Body isLoggedIn={true}>
              <Content>{node}</Content>
            </Body>
          ),
          headers: {
            ...headers,
            'HX-Trigger': JSON.stringify({
              'mutebot:csrf-token-issued': csrfToken,
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
  node?: preact.VNode | Array<preact.VNode>;
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
      : (wholePage ? '<!DOCTYPE html>' : '') +
        (Array.isArray(node)
          ? node.map((n) => render(n)).join('\n\n')
          : render(node)),
});

const calculateMuteUntil = (
  muteUntilRelative: string | undefined,
  now: Date
): string | undefined => {
  if (muteUntilRelative == null) return undefined;
  switch (muteUntilRelative) {
    case '1h':
      return addHours(now, 1).toISOString();
    case '3h':
      return addHours(now, 3).toISOString();
    case '12h':
      return addHours(now, 12).toISOString();
    case '1d':
      return addDays(now, 1).toISOString();
    case '1w':
      return addWeeks(now, 1).toISOString();
    case '1m':
      return addMonths(now, 1).toISOString();
    case '1y':
      return addYears(now, 1).toISOString();
    default:
      return undefined;
  }
};

export const renderResponse = async (
  event: WebEvent
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  if (event.rawPath.startsWith('/login')) {
    const response = await processLoginRequest(event);
    return createHttpResponse(response);
  } else if (method === 'OPTIONS') {
    throw new httpError.MethodNotAllowed('OPTIONS not allowed');
  } else if (method === 'GET') {
    const { session, csrfToken } = await getAuthorizedSession(event, {
      validateCSRF: false,
    });

    if (event.headers['hx-request'] === 'true') {
      if (session == null) {
        throw new httpError.Unauthorized('Unknown Session');
      }
    } else {
      if (session == null) {
        return createHttpResponse({
          node: (
            <Page>
              <Body isLoggedIn={false}>
                <Login />
              </Body>
            </Page>
          ),
          wholePage: true,
        });
      }

      const { node, headers } = await renderPage(
        event.requestContext.http.path,
        session
      );
      return createHttpResponse({
        node: (
          <Page csrfToken={csrfToken}>
            <Body isLoggedIn={true}>
              <Content>{node}</Content>
            </Body>
          </Page>
        ),
        headers,
        wholePage: true,
      });
    }
  } else {
    const { session } = await getAuthorizedSession(event, {
      validateCSRF: true,
    });

    if (session == null) {
      throw new httpError.Unauthorized('Unknown Session');
    }

    switch (event.routeKey) {
      case 'POST /mutewords': {
        const body = event.body as unknown as Partial<{
          addMuteWord: 'true';
          unmuteWord: string;
          muteWord: string;
          muteUntil: string;
        }>;
        if (body.muteWord) {
          const now = new Date();
          const muteUntil = calculateMuteUntil(body.muteUntil, now);
          const muteWord = await addMuteWord(
            session.subscriberDid,
            body.muteWord,
            muteUntil
          );
          if (body.addMuteWord) {
            return createHttpResponse({
              node: [
                <MuteWordListItem>
                  <MuteWord muteWord={muteWord} now={now.toISOString()} />
                </MuteWordListItem>,
                <AddMuteWord oob={true} muteUntil={body.muteUntil} />,
              ],
            });
          }
          return createHttpResponse({
            node: <MuteWord muteWord={muteWord} now={now.toISOString()} />,
          });
        }
        if (body.unmuteWord) {
          await deleteMuteWord(session.subscriberDid, body.unmuteWord);
        }
        return {
          statusCode: 200,
          body: '',
        };
      }
      case 'POST /logout': {
        return createHttpResponse({
          node: (
            <Body isLoggedIn={false}>
              <Login />
            </Body>
          ),
          headers: {
            'Set-Cookie': cookie.serialize('mutebot-session', '', {
              httpOnly: true,
              maxAge: 0,
              path: '/',
              sameSite: 'strict',
            }),
          },
        });
      }
    }
  }
  throw new httpError.NotFound(`No route for ${event.routeKey}`);
};
