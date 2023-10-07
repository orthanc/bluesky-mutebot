export type SyncSubscriberQueueRecord = {
  subscriberDid: string;
  lastTriggered: string;
};

export type FollowingEntry = {
  did: string;
  handle: string;
};
export type FollowingSet = Record<string, Omit<FollowingEntry, 'did'>>;
