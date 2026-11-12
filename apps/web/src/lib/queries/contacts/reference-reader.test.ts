import { expect, it, vi } from 'vitest';
import {
  type ContactReferenceReader,
  createContactReferenceReader,
} from './reference-reader';
import type {
  ContactReferenceRequest,
  ContactReferenceResolution,
} from './references';

vi.mock('./backfill', () => ({ loadContactCheckpoint: vi.fn() }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactReferencePage: vi.fn(),
  fetchContactDirectoryPage: vi.fn(),
  fetchContactDirectoryByIds: vi.fn(),
}));
const input = (label: string): ContactReferenceRequest => ({
  labels: [label],
  matching: 'exact',
  excludeSecondaryInboxes: false,
});
const RESULT: ContactReferenceResolution = {
  matches: [{ complete: true, people: [] }],
  source: 'cache',
  offline: false,
};

it('keeps the physical native read serialized after cancellation and replaces pending inputs', async () => {
  const first = Promise.withResolvers<ContactReferenceResolution>();
  const lastStarted = Promise.withResolvers<void>();
  const read = vi
    .fn<ContactReferenceReader>()
    .mockImplementation(async (_viewer, _host, request) => {
      if (request.labels[0] === 'first') return first.promise;
      lastStarted.resolve();
      return RESULT;
    });
  const queue = createContactReferenceReader(read);
  const firstAbort = new AbortController();
  const one = queue.read(
    'viewer',
    undefined,
    input('first'),
    firstAbort.signal
  );
  const oneRejected = expect(one).rejects.toThrow();
  firstAbort.abort();
  await oneRejected;
  const two = queue.read(
    'viewer',
    undefined,
    input('second'),
    new AbortController().signal
  );
  const twoRejected = expect(two).rejects.toThrow('superseded');
  const three = queue.read(
    'viewer',
    undefined,
    input('third'),
    new AbortController().signal
  );
  const threeRejected = expect(three).rejects.toThrow('superseded');
  const four = queue.read(
    'viewer',
    undefined,
    input('last'),
    new AbortController().signal
  );
  await twoRejected;
  await threeRejected;
  expect(read).toHaveBeenCalledOnce();
  first.resolve(RESULT);
  await lastStarted.promise;
  expect(await four).toEqual(RESULT);
  expect(read.mock.calls.map((call) => call[2].labels[0])).toEqual([
    'first',
    'last',
  ]);
  queue.dispose();
});

it('disposal rejects waiting callers and never promotes an old pending request', async () => {
  const physical = Promise.withResolvers<ContactReferenceResolution>();
  const read = vi
    .fn<ContactReferenceReader>()
    .mockReturnValue(physical.promise);
  const queue = createContactReferenceReader(read);
  const one = queue.read(
    'viewer',
    undefined,
    input('one'),
    new AbortController().signal
  );
  const two = queue.read(
    'viewer',
    undefined,
    input('two'),
    new AbortController().signal
  );
  const rejected = Promise.all([
    expect(one).rejects.toThrow(),
    expect(two).rejects.toThrow(),
  ]);
  queue.dispose();
  await rejected;
  physical.resolve(RESULT);
  await physical.promise;
  expect(read).toHaveBeenCalledOnce();
  await expect(
    queue.read('viewer', undefined, input('late'), new AbortController().signal)
  ).rejects.toThrow();
});

it('rejects oversized inputs before they can occupy the pending slot', async () => {
  const physical = Promise.withResolvers<ContactReferenceResolution>();
  const read = vi
    .fn<ContactReferenceReader>()
    .mockReturnValue(physical.promise);
  const queue = createContactReferenceReader(read);
  const first = queue.read(
    'viewer',
    undefined,
    input('one'),
    new AbortController().signal
  );
  await expect(
    queue.read(
      'viewer',
      undefined,
      { ...input('oversized'), labels: Array(501).fill('same') },
      new AbortController().signal
    )
  ).rejects.toThrow('Invalid contact reference request');
  physical.resolve(RESULT);
  await first;
  expect(read).toHaveBeenCalledOnce();
  queue.dispose();
});
