import type { readContactDirectory } from '@queries/contacts/directory';
import { beforeEach, expect, it, vi } from 'vitest';
import { readTeamContacts } from './team-contacts';

vi.mock('@queries/auth/use-query-account', () => ({
  useQueryAccount: () => () => undefined,
}));
vi.mock('@queries/contacts/use-directory', () => ({
  useContactDirectoryScope: () => () => ({}),
}));
const read = vi.fn<typeof readContactDirectory>();
beforeEach(() => {
  read.mockReset();
});

it('follows empty continuations and bounds retained suggestions, excluding self and domain aliases', async () => {
  read.mockImplementation(async (viewer, _host, request) => {
    const page =
      request.cursor?.source === 'people' ? Number(request.cursor.after) : 0;
    return {
      query: request.query,
      source: 'cache',
      sync: 'unavailable',
      offline: false,
      users:
        page < 5
          ? []
          : [
              {
                id: 'macro|self@team.example.com',
                email: 'SELF@team.example.com',
                name: 'Self',
              },
              {
                id: 'macro|other@unrelated.example.com',
                email: 'other@unrelated.example.com',
                name: 'team.example.com',
              },
              ...Array.from({ length: 20 }, (_, i) => ({
                id: `macro|person${i}@team.example.com`,
                email: `person${i}@team.example.com`,
                name: 'Person',
              })),
            ],
      nextCursor: {
        userId: viewer,
        query: request.query,
        source: 'people',
        generation: 'fixture',
        policyKey: '',
        after: String(page + 1),
      },
    };
  });
  const result = await readTeamContacts(
    'viewer',
    undefined,
    'team.example.com',
    'self@team.example.com',
    new AbortController().signal,
    read
  );
  expect(result).toEqual(
    Array.from({ length: 6 }, (_, i) => `person${i}@team.example.com`)
  );
  expect(read).toHaveBeenCalledTimes(6);
  expect(
    read.mock.calls.every(
      (call) => call[2].query === '' && call[2].limit === 50
    )
  ).toBe(true);
});

it('deduplicates addresses case-insensitively and stops at source exhaustion', async () => {
  read.mockResolvedValue({
    query: '@team.example.com',
    users: [
      {
        id: 'macro|one@team.example.com',
        email: 'one@team.example.com',
        name: 'One',
      },
      {
        id: 'macro|one@team.example.com',
        email: 'ONE@team.example.com',
        name: 'One',
      },
    ],
    source: 'cache',
    sync: 'unavailable',
    offline: false,
    nextCursor: null,
  });
  expect(
    await readTeamContacts(
      'viewer',
      undefined,
      'team.example.com',
      undefined,
      new AbortController().signal,
      read
    )
  ).toEqual(['one@team.example.com']);
  expect(read).toHaveBeenCalledTimes(1);
});

it('discards an aborted response without advancing or publishing suggestions', async () => {
  const started = Promise.withResolvers<void>();
  const page =
    Promise.withResolvers<Awaited<ReturnType<typeof readContactDirectory>>>();
  read.mockImplementation(async () => {
    started.resolve();
    return await page.promise;
  });
  const controller = new AbortController();
  const pending = readTeamContacts(
    'viewer',
    undefined,
    'team.example.com',
    undefined,
    controller.signal,
    read
  );
  await started.promise;
  controller.abort();
  page.resolve({
    query: '',
    users: [],
    source: 'cache',
    sync: 'unavailable',
    offline: false,
    nextCursor: null,
  });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).toHaveBeenCalledTimes(1);
});

it('rejects a nonadvancing continuation without accumulating history', async () => {
  read.mockResolvedValue({
    query: '',
    users: [],
    source: 'cache',
    sync: 'unavailable',
    offline: false,
    nextCursor: {
      userId: 'viewer',
      query: '',
      source: 'people',
      generation: 'fixture',
      policyKey: '',
      after: 'same',
    },
  });
  await expect(
    readTeamContacts(
      'viewer',
      undefined,
      'team.example.com',
      undefined,
      new AbortController().signal,
      read
    )
  ).rejects.toThrow('did not advance');
  expect(read).toHaveBeenCalledTimes(2);
});
