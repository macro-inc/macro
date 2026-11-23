import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import type { ContactReferenceReader } from '@queries/contacts/reference-reader';
import type {
  ContactReferenceHost,
  ContactReferenceResolution,
} from '@queries/contacts/references';
import { expect, it, vi } from 'vitest';
import { readImportAssignees } from './assignees';

vi.mock('@queries/contacts/use-directory', () => ({
  useContactDirectoryScope: () => () => ({}),
}));

it('serializes wire-sized batches and retains only requested matches, isolating invalid labels', async () => {
  const first = Promise.withResolvers<ContactReferenceResolution>();
  const entered = Promise.withResolvers<void>();
  const read = vi.fn<ContactReferenceReader>();
  read.mockImplementationOnce(async () => {
    entered.resolve();
    return await first.promise;
  });
  read.mockImplementation(async (_viewer, _host, request) => ({
    source: 'server',
    offline: false,
    matches: request.labels.map(() => ({ complete: true, people: [] })),
  }));
  const labels = Array.from({ length: 501 }, (_, index) => `Person ${index}`);
  labels.push('x'.repeat(1025));
  const pending = readImportAssignees(
    'viewer',
    undefined,
    labels,
    new AbortController().signal,
    read
  );
  await entered.promise;
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0][2]).toEqual({
    labels: labels.slice(0, 500),
    matching: 'exact',
    excludeSecondaryInboxes: false,
  });
  first.resolve({
    source: 'server',
    offline: false,
    matches: labels.slice(0, 500).map(() => ({ complete: true, people: [] })),
  });
  const result = await pending;
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls[1][2].labels).toEqual(['Person 500']);
  expect(result).toHaveLength(502);
  expect(result.every((entry) => entry.match.kind === 'unmatched')).toBe(true);
});

it('requires one complete witness and keeps model/CSV label boundaries', async () => {
  const person = {
    userId: 'macro|person@example.com',
    email: 'person@example.com',
    name: 'Family, Given',
  };
  const read = vi.fn<ContactReferenceReader>().mockResolvedValue({
    source: 'cache',
    offline: false,
    matches: [
      { complete: true, people: [person] },
      {
        complete: true,
        people: [
          person,
          {
            ...person,
            userId: 'macro|other@example.com',
            email: 'other@example.com',
          },
        ],
      },
      { complete: false, people: [person] },
    ],
  });
  const result = await readImportAssignees(
    'viewer',
    undefined,
    ['Family, Given', 'Shared', 'Partial'],
    new AbortController().signal,
    read
  );
  expect(result).toEqual([
    {
      label: 'Family, Given',
      match: {
        kind: 'matched',
        person: { id: person.userId, email: person.email, name: person.name },
      },
    },
    { label: 'Shared', match: { kind: 'ambiguous' } },
    { label: 'Partial', match: { kind: 'unavailable' } },
  ]);
  expect(read.mock.calls[0][2].labels).toEqual([
    'Family, Given',
    'Shared',
    'Partial',
  ]);
});

it('never combines evidence across storage generations', async () => {
  let generation = '00000000-0000-4000-8000-000000000001';
  const host: ContactReferenceHost = {
    clientId: 'fixture',
    disabled: false,
    currentStorageGeneration: async () => generation,
    readQuery: async () => ({ kind: 'hit', data: { user: { id: 'viewer' } } }),
    readRecordsByKeys: async () => ({
      revision: INITIAL_CACHE_REVISION,
      records: [],
    }),
  };
  const read = vi
    .fn<ContactReferenceReader>()
    .mockImplementation(async (_viewer, _host, request) => {
      if (request.labels.length === 1)
        generation = '00000000-0000-4000-8000-000000000002';
      return {
        source: 'cache',
        offline: false,
        matches: request.labels.map(() => ({ complete: true, people: [] })),
      };
    });
  const labels = Array.from({ length: 501 }, (_, index) => `Person ${index}`);
  await expect(
    readImportAssignees(
      'viewer',
      host,
      labels,
      new AbortController().signal,
      read
    )
  ).rejects.toThrow('Contact directory scope changed');
  expect(read).toHaveBeenCalledTimes(2);
});

it('does not start another batch after cancellation', async () => {
  const entered = Promise.withResolvers<void>();
  const first = Promise.withResolvers<ContactReferenceResolution>();
  const read = vi.fn<ContactReferenceReader>().mockImplementation(async () => {
    entered.resolve();
    return await first.promise;
  });
  const controller = new AbortController();
  const labels = Array.from({ length: 501 }, (_, i) => `Person ${i}`);
  const pending = readImportAssignees(
    'viewer',
    undefined,
    labels,
    controller.signal,
    read
  );
  await entered.promise;
  controller.abort();
  first.resolve({
    source: 'cache',
    offline: false,
    matches: labels.slice(0, 500).map(() => ({ complete: true, people: [] })),
  });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).toHaveBeenCalledTimes(1);
});
