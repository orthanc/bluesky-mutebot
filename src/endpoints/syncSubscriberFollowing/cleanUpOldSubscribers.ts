import {
  listSubscriberSyncBefore,
  triggerClearSubscriber,
} from '../../followingStore';

export const handler = async (): Promise<void> => {
  const beforeDate = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  console.log(`Cleaning up subscribers prior to ${beforeDate}`);

  for await (const subscriber of listSubscriberSyncBefore(beforeDate)) {
    console.log(subscriber);
    await triggerClearSubscriber(subscriber);
  }
};
