import { BskyAgent } from '@atproto/api';

export const getBskyAgent = async () => {
  const agent = new BskyAgent({ service: 'https://bsky.social' });
  await agent.login({
    identifier: process.env.BLUESKY_SERVICE_IDENTIFIER ?? 'unknown',
    password: process.env.BLUESKY_SERVICE_PASSWORD ?? 'unknown',
  });
  return agent;
};
