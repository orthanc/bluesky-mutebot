import { STATIC_CONTENT_BASE } from './constants';

/* eslint-disable @typescript-eslint/ban-ts-comment */
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
      <link
        href={`${STATIC_CONTENT_BASE}/${
          process.env.IS_OFFLINE
            ? `mutebot.dev.css`
            : `${process.env.MUTEBOT_CSS_NAME}`
        }`}
        rel="stylesheet"
      />
      <style>[x-cloak] {'{ display: none !important; }'}</style>
      <link
        rel="icon"
        type="image/png"
        sizes="16x16"
        href={`${STATIC_CONTENT_BASE}/favicon-16x16-cf9f061f2cae78c166301a54e2fbd87cdb243273dd2b38c58c23987fde4159ad.png`}
      />
      <link
        rel="icon"
        type="image/png"
        sizes="32x32"
        href={`${STATIC_CONTENT_BASE}/favicon-32x32-2f075c48175c1abb1338119688f90b3525d1e9802fd8a4ca604868faa1112fff.png`}
      />
      <link
        rel="icon"
        type="image/png"
        sizes="96x96"
        href={`${STATIC_CONTENT_BASE}/favicon-96x96-8972dc60894a5e7f7395075e23a0d07c4aa37b622c3fc950b1af81d17ab69e35.png`}
      />
      <link
        rel="icon"
        type="image/png"
        sizes="180x180"
        href={`${STATIC_CONTENT_BASE}/favicon-180x180-9d5072e30a9e91304cb40a8d08541c2db1e2a0d8dbadf76f68b5d2f8821a342d.png`}
      />
      <script src={`${STATIC_CONTENT_BASE}/htmx-1.9.9.min.js`}></script>
      <script src={`${STATIC_CONTENT_BASE}/htmx-ext-ws-1.9.9.js`}></script>
      <script type="module">
        import {'{parseISO, formatRelative}'} from
        'https://cdn.jsdelivr.net/npm/date-fns@3.3.1/+esm'; window.dateFns =
        {'{parseISO, formatRelative}'};
      </script>
      <script src="//unpkg.com/alpinejs" defer></script>
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
