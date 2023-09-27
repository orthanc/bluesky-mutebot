import middy from '@middy/core';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  AggregateListRecord,
  deleteAggregateListRecord,
  recordListItemId,
} from '../../followingStore';
import { getBskyAgent } from '../../bluesky';

export const rawHandler = async (event: AggregateListRecord): Promise<void> => {
  const agent = await getBskyAgent();
  if (event.followedBy === 0) {
    console.log('Deleting: ' + JSON.stringify(event));
    await agent.app.bsky.graph.listitem.delete({
      repo: process.env.BLUESKY_SERVICE_USER_DID,
      rkey: event.listItemRid,
    });
    await deleteAggregateListRecord(event.qualifier);
  } else {
    console.log('Adding: ' + JSON.stringify(event));
    const listItemResponse = await agent.app.bsky.graph.listitem.create(
      {
        repo: process.env.BLUESKY_SERVICE_USER_DID,
      },
      {
        list: process.env.BLUESKY_FOLLOWING_LIST ?? '??unknown list ??',
        subject: event.qualifier,
        createdAt: new Date().toISOString(),
      }
    );
    console.log(JSON.stringify(listItemResponse, undefined, 2));

    const uri = listItemResponse.uri;
    const rid = uri.split('/').pop() as string;

    await recordListItemId(event.qualifier, uri, rid);
  }
};

export const handler = middy(rawHandler).before((request) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  request.event = unmarshall(request.event.Records[0].dynamodb?.NewImage);
});
