import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  write: vi.fn<() => Promise<boolean>>(),
  preview: vi.fn(),
  history: vi.fn(),
  soup: vi.fn(),
  rollback: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@core/component/FileList/itemOperations', () => ({
  setFileType: mocks.write,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@queries/history/history', () => ({
  setHistoryItemFileType: mocks.history,
}));
vi.mock('@queries/preview', () => ({ setPreviewFileType: mocks.preview }));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: () => undefined,
  optimisticUpdateSoupEntity: mocks.soup,
}));
vi.mock('@queries/soup/normalized-cache/own-touch', () => ({
  ownTouchStamp: () => '2026-10-01T00:00:00Z',
}));

import { createUpdateFileTypeMutation } from './file-type';

let client: QueryClient;
let dispose: (() => void) | undefined;
let cache: { preview: string; history: string; soup: string };
let mutation: ReturnType<typeof createUpdateFileTypeMutation>;

beforeEach(() => {
  vi.resetAllMocks();
  cache = { preview: 'txt', history: 'txt', soup: 'txt' };
  mocks.preview.mockImplementation((_id: string, fileType: string) => {
    cache.preview = fileType;
  });
  mocks.history.mockImplementation((_id: string, fileType: string) => {
    cache.history = fileType;
  });
  mocks.soup.mockImplementation(({ data }: { data: { fileType: string } }) => {
    const original = cache.soup;
    cache.soup = data.fileType;
    mocks.rollback.mockImplementation(() => {
      cache.soup = original;
    });
    return { rollback: mocks.rollback };
  });
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        {(() => {
          mutation = createUpdateFileTypeMutation();
          return null;
        })()}
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
});
afterEach(() => {
  dispose?.();
  client.clear();
});

it.each([false, true])(
  'rolls back a failed write only in its original generation (retired=%s)',
  async (retired) => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<boolean>();
    mocks.write.mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const pending = mutation.mutateAsync({
      id: 'document',
      fileType: 'md',
      oldFileType: 'txt',
    });
    const rejected = expect(pending).rejects.toThrow(
      'Failed to update file type'
    );
    await started.promise;
    expect(cache).toEqual({ preview: 'md', history: 'md', soup: 'md' });
    if (retired) {
      await cacheSessionGeneration.transition(async () => {
        cache = { preview: 'pdf', history: 'pdf', soup: 'pdf' };
      });
    }
    response.resolve(false);
    await rejected;
    const expected = retired ? 'pdf' : 'txt';
    expect(cache).toEqual({
      preview: expected,
      history: expected,
      soup: expected,
    });
    expect(mocks.rollback).toHaveBeenCalledTimes(retired ? 0 : 1);
    expect(mocks.failure).toHaveBeenCalledExactlyOnceWith(
      'Failed to update file type'
    );
  }
);

it('preserves a successful server outcome across retirement without restoring old data', async () => {
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<boolean>();
  mocks.write.mockImplementation(() => {
    started.resolve();
    return response.promise;
  });
  const pending = mutation.mutateAsync({
    id: 'document',
    fileType: 'md',
    oldFileType: 'txt',
  });
  await started.promise;
  await cacheSessionGeneration.transition(async () => {
    cache = { preview: 'pdf', history: 'pdf', soup: 'pdf' };
  });
  response.resolve(true);
  await expect(pending).resolves.toBe(true);
  expect(cache).toEqual({ preview: 'pdf', history: 'pdf', soup: 'pdf' });
  expect(mocks.rollback).not.toHaveBeenCalled();
  expect(mocks.failure).not.toHaveBeenCalled();
});
