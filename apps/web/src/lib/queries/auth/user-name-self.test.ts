import { QueryClient } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentQueryAccount, resetQueryAccountSession } from './account-scope';
import { authKeys } from './keys';
import { ownUserNameQueryOptions } from './user-name-self';

const getName = vi.hoisted(() => vi.fn());
let client: QueryClient;
vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getUserName: getName },
}));
const identity = { id: 'macro|viewer@example.com', authenticated: true };
beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getName.mockReset();
  client.setQueryData(authKeys.userInfo.queryKey, identity);
  await resetQueryAccountSession();
  await client.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: async () => identity,
  });
});
afterEach(() => client.clear());

it('does not reuse legacy unscoped own-name values or an earlier login', async () => {
  client.setQueryData(authKeys.userNameSelf._def, {
    id: 'legacy',
    first_name: 'Old',
  });
  getName.mockResolvedValue(
    ok({ id: '00000000-0000-4000-8000-000000000001', first_name: 'Current' })
  );
  const first = ownUserNameQueryOptions(currentQueryAccount());
  expect((await client.fetchQuery(first)).first_name).toBe('Current');
  await resetQueryAccountSession();
  expect(client.getQueryData(first.queryKey)).toBeUndefined();
  expect(ownUserNameQueryOptions(currentQueryAccount()).enabled).toBe(false);
  await client.fetchQuery({
    queryKey: authKeys.userInfo.queryKey,
    queryFn: async () => identity,
  });
  const second = ownUserNameQueryOptions(currentQueryAccount());
  expect(second.queryKey).not.toEqual(first.queryKey);
});

it('rejects a late editable-name response after account replacement', async () => {
  const held =
    Promise.withResolvers<Ok<{ id: string; first_name: string }, unknown>>();
  getName.mockReturnValue(held.promise);
  const pending = client.fetchQuery(
    ownUserNameQueryOptions(currentQueryAccount())
  );
  const rejected = expect(pending).rejects.toThrow();
  client.setQueryData(authKeys.userInfo.queryKey, {
    ...identity,
    id: 'macro|other@example.com',
  });
  held.resolve(ok({ id: 'old-profile', first_name: 'Private old' }));
  await rejected;
});
