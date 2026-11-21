import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { teamKeys } from './keys';
import { useTeammateIds } from './roster';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('lists the roster the app already loaded, and never fetches it', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  let ids: Accessor<ReadonlySet<string>> | undefined;
  function Harness() {
    ids = useTeammateIds(() => true);
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  expect([...ids!()]).toEqual([]);
  expect(client.isFetching()).toBe(0);

  client.setQueryData(teamKeys.currentTeam.queryKey, {
    members: [
      { user_id: 'macro|Ana@Example.com' },
      { user_id: 'macro|sam@example.com' },
    ],
  });
  await vi.advanceTimersByTimeAsync(0);
  expect([...ids!()]).toEqual([
    'macro|ana@example.com',
    'macro|sam@example.com',
  ]);

  // Someone who leaves their team has no teammates.
  client.setQueryData(teamKeys.currentTeam.queryKey, null);
  await vi.advanceTimersByTimeAsync(0);
  expect([...ids!()]).toEqual([]);
  expect(client.isFetching()).toBe(0);
  client.clear();
});
