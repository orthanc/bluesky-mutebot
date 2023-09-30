import middy from '@middy/core';
import {
  getAggregateListRecord,
  recordFollowingEntryId,
} from '../../followingStore';
import { getBskyAgent } from '../../bluesky';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

export type UpdateFollowingEvent =
  | {
      type: 'add';
      userDid: string;
    }
  | {
      type: 'remove';
      userDid: string;
      followingEntryUri: string;
      followingEntryRid: string;
    };

export const rawHandler = async (
  event: UpdateFollowingEvent
): Promise<void> => {
  const agent = await getBskyAgent();
  const existing = await getAggregateListRecord(event.userDid);
  if (event.type === 'remove') {
    if (existing != null) {
      console.log(
        'subscription record recreated, linking subscription: ' +
          JSON.stringify(event)
      );
      // Just upedate details
      await recordFollowingEntryId(
        event.userDid,
        event.followingEntryUri,
        event.followingEntryRid
      );
    } else {
      console.log('Unfollowing: ' + JSON.stringify(event));
      await agent.app.bsky.graph.follow.delete({
        repo: process.env.BLUESKY_SERVICE_USER_DID,
        rkey: event.followingEntryRid,
      });
    }
  } else {
    if (existing == null) {
      // No op
      console.log(
        'subscription record already deleted, skipping follow: ' +
          JSON.stringify(event)
      );
    } else if (existing.followingEntryRid != null) {
      // No op
      console.log(
        'subscription record already has following entry rid, skipping follow: ' +
          JSON.stringify(event)
      );
    } else {
      console.log('Following: ' + JSON.stringify(event));
      const followResponse = await agent.follow(event.userDid);
      console.log(JSON.stringify(followResponse, undefined, 2));

      const uri = followResponse.uri;
      const rid = uri.split('/').pop() as string;

      try {
        await recordFollowingEntryId(event.userDid, uri, rid);
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          console.log(
            'subscription deleted before follow entry recorded, deleting subscription'
          );

          await agent.app.bsky.graph.follow.delete({
            repo: process.env.BLUESKY_SERVICE_USER_DID,
            rkey: rid,
          });
        } else {
          throw error;
        }
      }
    }
  }
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  request.event = JSON.parse(request.event.Records[0].body);
});
