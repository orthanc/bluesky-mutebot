import { FollowedUserSettings } from '../../../muteWordsStore';
import { FollowingSet } from '../../../types';
import { RetweetSettings } from './RetweetSettings';

export const RetweetSettingsContent = ({
  handle,
  following,
  followedUserSettings,
  now,
}: {
  handle: string;
  following: FollowingSet;
  followedUserSettings: Record<string, FollowedUserSettings>;
  now: string;
}) => (
  <>
    <h2 className="text-lg font-bold">Retweet Settings for @{handle}</h2>
    <RetweetSettings
      following={following}
      followedUserSettings={followedUserSettings}
      now={now}
    />
  </>
);
