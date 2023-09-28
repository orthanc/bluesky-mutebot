import middy from '@middy/core';
import { getAggregateListRecord, recordListItemId } from '../../followingStore';
import { getBskyAgent } from '../../bluesky';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

export type UpdateListEvent =
  | {
      type: 'add';
      userDid: string;
    }
  | {
      type: 'remove';
      userDid: string;
      listItemUri: string;
      listItemRid: string;
    };

export const rawHandler = async (event: UpdateListEvent): Promise<void> => {
  const agent = await getBskyAgent();
  const existing = await getAggregateListRecord(event.userDid);
  if (event.type === 'remove') {
    if (existing != null) {
      console.log(
        'subscription record recreated, linking subscription: ' +
          JSON.stringify(event)
      );
      // Just upedate details
      await recordListItemId(
        event.userDid,
        event.listItemUri,
        event.listItemRid
      );
    } else {
      console.log('Removing from list: ' + JSON.stringify(event));
      await agent.app.bsky.graph.listitem.delete({
        repo: process.env.BLUESKY_SERVICE_USER_DID,
        rkey: event.listItemRid,
      });
    }
  } else {
    if (existing == null) {
      // No op
      console.log(
        'subscription record already deleted, skipping list add: ' +
          JSON.stringify(event)
      );
    } else if (existing.listItemRid != null) {
      // No op
      console.log(
        'subscription record already has list rid, skipping list add: ' +
          JSON.stringify(event)
      );
    } else {
      console.log('Adding: ' + JSON.stringify(event));
      const listItemResponse = await agent.app.bsky.graph.listitem.create(
        {
          repo: process.env.BLUESKY_SERVICE_USER_DID,
        },
        {
          list: process.env.BLUESKY_FOLLOWING_LIST ?? '??unknown list ??',
          subject: event.userDid,
          createdAt: new Date().toISOString(),
        }
      );
      console.log(JSON.stringify(listItemResponse, undefined, 2));

      const uri = listItemResponse.uri;
      const rid = uri.split('/').pop() as string;

      try {
        await recordListItemId(event.userDid, uri, rid);
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          console.log(
            'subscription deleted before list rid recorded, deleting subscription'
          );

          await agent.app.bsky.graph.listitem.delete({
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
