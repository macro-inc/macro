import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  preview: vi.fn(),
  history: vi.fn(async () => undefined),
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    projects: { create: mocks.create },
    upsertItemToUserHistory: mocks.history,
  },
}));
vi.mock('@queries/preview/preview', () => ({
  setPreviewOnCreate: mocks.preview,
}));
vi.mock('@queries/history/history', () => ({
  refetchHistory: vi.fn(async () => {}),
}));
vi.mock('@queries/soup/cache', () => ({
  refetchSoupEntity: vi.fn(async () => {}),
}));
vi.mock('./graphql-folders', () => ({
  refreshActiveGraphqlFoldersQueries: vi.fn(async () => {}),
}));

import { createProject } from './projects';

it('keeps a completed creation outcome without publishing it into a later session', async () => {
  const result = Promise.withResolvers<{ id: string }>();
  mocks.create.mockImplementation(async () => ok(await result.promise));
  const pending = createProject({ name: 'Folder' });
  await cacheSessionGeneration.transition(async () => {});
  result.resolve({ id: 'created-in-old-session' });

  await expect(pending).resolves.toBe('created-in-old-session');
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.history).not.toHaveBeenCalled();
});
