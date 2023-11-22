/* eslint-disable @typescript-eslint/ban-ts-comment */
const STATIC_CONTENT_BASE = process.env.IS_OFFLINE
  ? `https://${process.env.WEB_DOMAIN_NAME}`
  : '';

function gloabalEventHandler() {
  window.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('mutebot:csrf-token-issued', (e) => {
      // @ts-ignore
      window.csrfToken = e.detail.value;
    });
    // @ts-ignore
    const addCsrfToken = (e) => {
      // @ts-ignore
      if (window.csrfToken != null) {
        // @ts-ignore
        e.detail.headers['X-CSRF-Token'] = window.csrfToken;
      }
    };
    document.body.addEventListener('htmx:configRequest', addCsrfToken);
    setInterval(
      () => document.body.dispatchEvent(new Event('mutebot:ping')),
      10000
    );
  });
}

export type PageProps = { csrfToken?: string };

export const Page: preact.FunctionComponent<PageProps> = ({
  csrfToken,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Mutebot Control Panel</title>
      <script src={`${STATIC_CONTENT_BASE}/htmx-1.9.6.min.js`}></script>
      <script src={`${STATIC_CONTENT_BASE}/htmx-ext-ws-1.9.6.js`}></script>
      {csrfToken == null ? null : (
        <script
          dangerouslySetInnerHTML={{
            __html: `window.csrfToken = ${JSON.stringify(csrfToken)};`,
          }}
        />
      )}
      <script
        dangerouslySetInnerHTML={{
          __html: `(${gloabalEventHandler.toString()})();`,
        }}
      />
    </head>
    {children}
  </html>
);
