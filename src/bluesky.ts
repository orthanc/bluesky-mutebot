import { BskyAgent } from '@atproto/api';

const agent = new BskyAgent({ service: 'https://bsky.social' });
export const getBskyAgent = async () => {
  if (agent.hasSession) {
    console.log('already logged in');
  } else {
    console.log('logging in');
    await agent.login({
      identifier: process.env.BLUESKY_SERVICE_IDENTIFIER ?? 'unknown',
      password: process.env.BLUESKY_SERVICE_PASSWORD ?? 'unknown',
    });
  }
  return agent;
};
