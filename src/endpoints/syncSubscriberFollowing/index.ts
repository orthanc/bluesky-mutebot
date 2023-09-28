import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { FollowingSet, SyncSubscriberQueueRecord } from '../../types';
import { getBskyAgent } from '../../bluesky';
import { BskyAgent } from '@atproto/api';
import {
  FollowingUpdate,
  getSubscriberFollowingRecord,
  saveUpdates,
} from '../../followingStore';

const getAllFollowing = async (
  agent: BskyAgent,
  actor: string
): Promise<FollowingSet> => {
  const result: FollowingSet = {};

  let cursor: string | undefined = undefined;
  do {
    console.log(`Fetching with ${cursor}`);
    const followersResponse = await agent.getFollows({
      actor,
      limit: 100,
      cursor,
    });
    cursor = followersResponse.data.cursor;
    for (const following of followersResponse.data.follows) {
      result[following.did] = { handle: following.handle };
    }
  } while (cursor != null);

  return result;
};

export const rawHandler = async (
  event: SyncSubscriberQueueRecord
): Promise<void> => {
  const agent = await getBskyAgent();
  const [newFollowing, existingRecord] = await Promise.all([
    getAllFollowing(agent, event.subscriberDid),
    getSubscriberFollowingRecord(event.subscriberDid),
  ]);
  const operations: Array<FollowingUpdate> = [];
  Object.entries(newFollowing)
    .filter(([did]) => !existingRecord.following[did])
    .forEach(([did, rest]) =>
      operations.push({ operation: 'add', following: { did, ...rest } })
    );

  Object.entries(existingRecord.following)
    .filter(([did]) => !newFollowing[did])
    .forEach(([did, rest]) =>
      operations.push({ operation: 'remove', following: { did, ...rest } })
    );

  await saveUpdates(existingRecord, operations);
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  request.event = unmarshall(request.event.Records[0].dynamodb?.NewImage);
});
