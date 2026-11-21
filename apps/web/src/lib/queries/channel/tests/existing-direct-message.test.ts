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
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: mocks.query }),
}));
vi.mock('../directory', () => ({
  refreshChannelDirectory: vi.fn(async () => undefined),
}));

import { QueryAccountChangedError } from '../../auth/account-scope';
import { authKeys } from '../../auth/keys';
import { existingDirectMessage } from '../get-or-create-dm';

const VIEWER = 'macro|viewer@example.com';
const PERSON = 'macro|person@example.com';

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

it('asks the server for the DM with a person, skipping every cache', async () => {
  answers({ data: { user: { id: VIEWER, directMessageChannelId: 'dm-1' } } });
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found._unsafeUnwrap()).toBe('dm-1');
  expect(mocks.query).toHaveBeenCalledWith(
    expect.anything(),
    { userId: PERSON },
    { requestPolicy: 'network-only' }
  );
});

it('answers none when the server has no DM with that person', async () => {
  answers({ data: { user: { id: VIEWER, directMessageChannelId: null } } });
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found._unsafeUnwrap()).toBeUndefined();
});

it.each([
  ['the viewer', VIEWER],
  ['an agent', 'bot|0190f0a0-0000-7000-8000-000000000001'],
])('answers none for %s without asking', async (_, recipient) => {
  const found = await existingDirectMessage(VIEWER, recipient);
  expect(found._unsafeUnwrap()).toBeUndefined();
  expect(mocks.query).not.toHaveBeenCalled();
});

it('fails when the lookup fails, so the opener can still show an empty DM', async () => {
  const error = new Error('lookup failed');
  answers({ error });
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found._unsafeUnwrapErr()).toBe(error);
});

it('fails when another account signed in during the lookup', async () => {
  mocks.query.mockReturnValue({
    toPromise: async () => {
      mocks.client?.setQueryData(authKeys.userInfo.queryKey, {
        id: 'macro|other@example.com',
        authenticated: true,
      });
      return {
        data: { user: { id: VIEWER, directMessageChannelId: 'dm-1' } },
      };
    },
  });
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found.isErr()).toBe(true);
});

it('fails without asking when the viewer is no longer the one signed in', async () => {
  mocks.client?.setQueryData(authKeys.userInfo.queryKey, {
    id: 'macro|other@example.com',
    authenticated: true,
  });
  const found = await existingDirectMessage(VIEWER, PERSON);
  expect(found._unsafeUnwrapErr()).toBeInstanceOf(QueryAccountChangedError);
  expect(mocks.query).not.toHaveBeenCalled();
});
