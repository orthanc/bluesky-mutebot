import classNames from 'classnames';
import { STATIC_CONTENT_BASE } from './constants';

export type PageId = 'mute-words' | 'followed-user-settings' | 'login';

export const Body: preact.FunctionComponent<{
  isLoggedIn: boolean;
  page: PageId;
}> = ({ children, isLoggedIn, page }) => (
  <body className="bg-slate-300 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
    <div className="flex flex-col min-h-[60svh]">
      <div className="sticky top-0  bg-bsky text-white">
        <div className="flex items-center p-4 gap-4">
          <img
            src={`${STATIC_CONTENT_BASE}/favicon-32x32-2f075c48175c1abb1338119688f90b3525d1e9802fd8a4ca604868faa1112fff.png`}
          />
          <h1 className="font-semibold">Mutebot</h1>
          {isLoggedIn ? (
            <div className="sm:flex space-x-4 text-sm pt-2 pl-4 hidden">
              <a
                href="/"
                className={classNames('block', {
                  'font-semibold': page === 'mute-words',
                })}
              >
                Mute words
              </a>
              <a
                href="/retweet-settings"
                className={classNames('block', {
                  'font-semibold': page === 'followed-user-settings',
                })}
              >
                Mute retweets
              </a>
            </div>
          ) : null}
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
                className="py-1 px-2 w-20 text-sm rounded-full  bg-slate-300 hover:bg-slate-400  text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-500 dark:text-slate-200"
              />
            </form>
          ) : null}
        </div>
        {isLoggedIn ? (
          <div className="sm:hidden space-x-4 text-sm px-4 pb-2 flex text-center">
            <a
              href="/"
              className={classNames('block flex-grow', {
                'font-semibold': page === 'mute-words',
              })}
            >
              Mute words
            </a>
            <a
              href="/retweet-settings"
              className={classNames('block flex-grow', {
                'font-semibold': page === 'followed-user-settings',
              })}
            >
              Mute retweets
            </a>
          </div>
        ) : null}
      </div>
      <div className="flex-grow flex justify-center px-4 pb-4">
        <div className="max-w-md w-full border-solid border border-t-0 rounded-b-xl border-slate-500 bg-slate-100 dark:bg-slate-900 p-4">
          {children}
        </div>
      </div>
    </div>
  </body>
);
