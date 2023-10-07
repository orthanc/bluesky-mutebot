export type SyncSubscriberQueueRecord = {
  subscriberDid: string;
  lastTriggered: string;
};

export type FollowingEntry = {
  did: string;
  handle: string;
};
export type FollowingSet = Record<string, Omit<FollowingEntry, 'did'>>;

export type PostEntry = {
  uri: string;
  createdAt: string;
  author: string;
  resolvedStatus: 'UNRESOLVED' | 'RESOLVED';
  expiresAt?: number;
  isReply?: true;
  replyRootUri?: string;
  replyRootAuthorDid?: string;
  replyParentUri?: string;
  replyRootParentDid?: string;
  startsWithMention?: true;
  mentionedDids: Array<string>;
  textEntries: Array<string>;
};

export type PostRecord = {
  uri: string;
  createdAt: string;
  author: string;
} & (
  | ({ type: 'post' } & PostEntry)
  | { type: 'repost'; repostedPostUri: string; post?: PostEntry }
);
