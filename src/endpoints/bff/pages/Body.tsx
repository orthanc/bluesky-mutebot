import { STATIC_CONTENT_BASE } from './constants';

export const Body: preact.FunctionComponent<{ isLoggedIn: boolean }> = ({
  children,
  isLoggedIn,
}) => (
  <body className="bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
    <div className="sticky flex items-center p-4 gap-4 bg-bsky text-white">
      <img
        src={`${STATIC_CONTENT_BASE}/favicon-32x32-2f075c48175c1abb1338119688f90b3525d1e9802fd8a4ca604868faa1112fff.png`}
      />
      <h1 className="font-semibold">Mutebot Control Panel</h1>
      <div className="flex-grow" />
      {isLoggedIn ? (
        <form
          hx-post="/logout"
          hx-target="body"
          hx-trigger="submit throttle:1s"
        >
          <input
            type="submit"
            value="Logout"
            className="py-1 px-2 rounded-xl border-solid border-2 border-slate-800 bg-slate-50 text-slate-600 dark:bg-slate-600 dark:text-slate-200 drop-shadow-lg"
          />
        </form>
      ) : null}
    </div>
    {children}
  </body>
);
