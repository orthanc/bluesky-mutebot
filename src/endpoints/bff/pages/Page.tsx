import { Content } from './Content';

/* eslint-disable @typescript-eslint/ban-ts-comment */
const STATIC_CONTENT_BASE = process.env.IS_OFFLINE
  ? `https://${process.env.WEB_DOMAIN_NAME}`
  : '';

function gloabalEventHandler() {
  let authToken: string | undefined = undefined;
  document.body.addEventListener('mutebot:auth-token-issued', (e) => {
    // @ts-ignore
    authToken = e.detail.value;
    console.log(e);
  });
  // @ts-ignore
  const addAuthToken = (e) => {
    if (authToken != null) {
      e.detail.headers['Authorization'] = `Bearer ${authToken}`;
    }
    console.log({ e, authToken });
  };
  document.body.addEventListener('htmx:configRequest', addAuthToken);
  document.body.addEventListener('htmx:wsConfigSend', addAuthToken);
  setInterval(
    () => document.body.dispatchEvent(new Event('mutebot:ping')),
    10000
  );
}

export const Page: preact.FunctionComponent = ({ children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Mutebot Control Panel</title>
      <script src={`${STATIC_CONTENT_BASE}/htmx-1.9.6.min.js`}></script>
      <script src={`${STATIC_CONTENT_BASE}/htmx-ext-ws-1.9.6.js`}></script>
    </head>
    <body hx-ext="ws">
      <Content>{children}</Content>
      <script>({gloabalEventHandler.toString()})();</script>
    </body>
  </html>
);
