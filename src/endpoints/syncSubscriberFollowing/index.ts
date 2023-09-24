import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { FollowingSet, SyncSubscriberQueueRecord } from '../../types';
import { getBskyAgent } from '../../bluesky';
import { BskyAgent } from '@atproto/api';

const getAllFollowing = async (
  agent: BskyAgent,
  actor: string
): Promise<FollowingSet> => {
  const result: FollowingSet = {};

  let cursor: string | undefined = undefined;
  do {
    console.log(`Fetching with ${cursor}`);
    const followersResponse = await agent.getFollowers({
      actor,
      limit: 100,
      cursor,
    });
    cursor = followersResponse.data.cursor;
    for (const following of followersResponse.data.followers) {
      result[following.did] = { handle: following.handle, followedBy: 1 };
    }
  } while (cursor != null);

  return result;
};

export const rawHandler = async (
  event: SyncSubscriberQueueRecord
): Promise<void> => {
  const agent = await getBskyAgent();
  const following = await getAllFollowing(agent, event.subscriberDid);
  console.log(Object.keys(following).length);
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  request.event = unmarshall(request.event.Records[0].dynamodb?.NewImage);
});
