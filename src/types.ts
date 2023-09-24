export type SyncSubscriberQueueRecord = {
  subscriberDid: string;
  lastTriggered: string;
};

export type FollowingSet = Record<
  string,
  { handle: string; followedBy: number }
>;

export type FollowingRecord = {
  subscriberDid: string;
  qualifier: 'user';
  following: FollowingSet;
  rev: number;
};
