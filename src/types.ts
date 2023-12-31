export type SyncSubscriberQueueRecord = {
  subscriberDid: string;
  lastTriggered: string;
  clear?: true;
  expiresAt?: number;
};

export type FollowingEntry = {
  did: string;
  handle: string;
};
export type FollowingSet = Record<
  string,
  Omit<FollowingEntry, 'did'> & { linkSaved?: true }
>;
