import classNames from 'classnames';
import { FollowedUserSettings } from '../../../muteWordsStore';
import { MuteFor } from './MuteFor';
import { Autocomplete } from './Autocomplete';
import { FollowingSet } from '../../../types';

export const FollowedUser: preact.FunctionComponent<{
  followedUserDid: string;
  followedUser: FollowedUserSettings;
  now: string;
}> = ({ followedUserDid, followedUser, now }) => {
  const expired =
    followedUser.muteRetweetsUntil !== 'forever' &&
    followedUser.muteRetweetsUntil < now;
  return (
    <>
      <div
        className={classNames(
          'flex-grow flex-shrink text-ellipsis overflow-x-hidden',
          {
            'text-gray-500': expired,
          }
        )}
      >
        {followedUser.handle}
      </div>
      <div x-data={JSON.stringify({ ...followedUser, editUntil: false })}>
        <div
          x-show="!editUntil"
          x-on:click="editUntil = !editUntil"
          className="text-xs text-gray-500 underline cursor-pointer"
        >
          {followedUser.muteRetweetsUntil === 'forever' ? (
            <>retweets muted forever</>
          ) : expired ? (
            <>retweet mute expired</>
          ) : (
            <>
              <div>retweets muted until </div>
              <div x-text="dateFns.formatRelative(dateFns.parseISO(muteRetweetsUntil), now)" />
            </>
          )}
        </div>
        <form hx-post="/followed-user" hx-trigger="change">
          <input type="hidden" name="followedDid" value={followedUserDid} />
          <input type="hidden" name="action" value="updateMuteRetweetsUntil" />
          <MuteFor name="muteRetweetsUntil" showWhen="editUntil" />
        </form>
      </div>
    </>
  );
};

export const FollowedUserListItem: preact.FunctionComponent = ({
  children,
}) => (
  <li className="flex border-slate-300 border-b p-2 space-x-2 items-center htmx-request:opacity-50">
    {children}
  </li>
);

export const AddFollowedUser: preact.FunctionComponent<{
  oob?: boolean;
  following: FollowingSet;
  muteUntil?: string;
}> = ({ oob, following, muteUntil }) => {
  const sortedFollowing = Object.entries(following)
    .map(([did, { handle }]) => ({ value: did, display: handle }))
    .sort((a, b) => a.display.localeCompare(b.display));
  return (
    <div
      className="p-2 rounded-b-lg border-t-0 border-slate-300 border bg-slate-50 dark:bg-slate-950 htmx-request:animate-pulse"
      id="add-mute-word"
      hx-indicator="this"
      {...(oob ? { 'hx-swap-oob': 'true' } : undefined)}
    >
      <label id="word-to-mute-label" className="text-sm font-semibold">
        Mute retweets from user
      </label>
      <form
        x-data={JSON.stringify({ selectedFollower: {} })}
        hx-post="/followed-user"
        hx-swap="beforeend"
        hx-target="#followed-user-settings"
        className="space-y-2"
      >
        <div>
          <Autocomplete data={sortedFollowing} x-model="selectedFollower" />
        </div>
        <div className="flex space-x-2 items-center">
          <div className="flex-grow">
            <MuteFor name="muteRetweetsUntil" selected={muteUntil} />
          </div>
          <div>
            <input
              type="hidden"
              name="followedDid"
              x-bind:value="selectedFollower && selectedFollower.value"
            />
            <input
              type="hidden"
              name="handle"
              x-bind:value="selectedFollower && selectedFollower.display"
            />
            <button
              name="action"
              value="add"
              className="rounded-full w-20 px-2 py-1 text-sm bg-bsky hover:bg-sky-500 text-white"
            >
              Mute Retweets
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export const RetweetSettings = ({
  following,
  followedUserSettings,
  now,
}: {
  following: FollowingSet;
  followedUserSettings: Record<string, FollowedUserSettings>;
  now: string;
}) => {
  return (
    <div
      className="mt-4 relative"
      hx-indicator="closest li"
      hx-target="closest li"
      x-data={JSON.stringify({ now })}
      x-show="true"
      x-cloak
    >
      <ul
        className="rounded-t-lg border-slate-300 border border-b-0 bg-slate-50 dark:bg-slate-950"
        id="followed-user-settings"
      >
        {Object.entries(followedUserSettings).map(
          ([followedUserDid, followedUser]) => (
            <FollowedUserListItem>
              <FollowedUser
                followedUserDid={followedUserDid}
                followedUser={followedUser}
                now={now}
              />
            </FollowedUserListItem>
          )
        )}
      </ul>
      <AddFollowedUser following={following} muteUntil="forever" />
    </div>
  );
};
