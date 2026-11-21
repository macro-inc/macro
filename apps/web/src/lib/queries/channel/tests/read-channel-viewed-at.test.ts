import { QueryClient } from '@tanstack/solid-query';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  client: undefined as QueryClient | undefined,
}));
vi.mock('../../client', () => ({
  get queryClient() {
    return mocks.client;
  },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: mocks.query }),
}));

import { authKeys } from '../../auth/keys';
import { readChannelViewedAt } from '../viewed-at';
import { channelUuid } from './channel-uuid';

const VIEWER = 'macro|viewer@example.com';
const CHANNEL = channelUuid('left');

function answers(result: object) {
  mocks.query.mockReturnValue({ toPromise: async () => result });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client = new QueryClient();
  mocks.client.setQueryData(authKeys.userInfo.queryKey, {
    id: VIEWER,
    authenticated: true,
  });
});

it("asks the server for the viewer's last view of a channel, skipping every cache", async () => {
  answers({
    data: {
      user: { id: VIEWER, channelViewedAt: '2026-11-20T10:00:00+00:00' },
    },
  });
  const viewedAt = await readChannelViewedAt(CHANNEL);
  expect(viewedAt._unsafeUnwrap()).toBe('2026-11-20T10:00:00+00:00');
  expect(mocks.query).toHaveBeenCalledWith(
    expect.anything(),
    { channelId: CHANNEL },
    { requestPolicy: 'network-only' }
  );
});

it('answers null for a channel the viewer never viewed', async () => {
  answers({ data: { user: { id: VIEWER, channelViewedAt: null } } });
  const viewedAt = await readChannelViewedAt(CHANNEL);
  expect(viewedAt._unsafeUnwrap()).toBeNull();
});

it('answers null for an id no channel can have, without asking', async () => {
  const viewedAt = await readChannelViewedAt('not-a-channel');
  expect(viewedAt._unsafeUnwrap()).toBeNull();
  expect(mocks.query).not.toHaveBeenCalled();
});

it('fails when the server fails, or answers nothing', async () => {
  const error = new Error('lookup failed');
  answers({ error });
  expect((await readChannelViewedAt(CHANNEL))._unsafeUnwrapErr()).toBe(error);
  answers({});
  expect((await readChannelViewedAt(CHANNEL)).isErr()).toBe(true);
});

it('fails when another account signed in during the read', async () => {
  mocks.query.mockReturnValue({
    toPromise: async () => {
      mocks.client?.setQueryData(authKeys.userInfo.queryKey, {
        id: 'macro|other@example.com',
        authenticated: true,
      });
      return {
        data: {
          user: { id: VIEWER, channelViewedAt: '2026-11-20T10:00:00+00:00' },
        },
      };
    },
  });
  expect((await readChannelViewedAt(CHANNEL)).isErr()).toBe(true);
});
