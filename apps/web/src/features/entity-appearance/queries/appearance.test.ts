import { entityKeys } from '@queries/storage/keys';
import { QueryClient } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DocumentEntity } from '../../entity/types/entity';
import type { EntityAppearance } from '../core/appearance';
import { createSaveEntityAppearance } from './appearance';

type UpdateAppearance = Parameters<
  typeof createSaveEntityAppearance
>[0]['update'];

const patches = vi.hoisted(() => ({ preview: vi.fn(), soup: vi.fn() }));
vi.mock('@queries/preview', () => ({ setPreviewAppearance: patches.preview }));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: () => undefined,
  hydrateSoupEntity: patches.soup,
}));

const entity: DocumentEntity = {
  type: 'document',
  id: 'document',
  name: 'Document',
  ownerId: 'viewer',
  fileType: 'md',
  subType: null,
};
const appearance: EntityAppearance = {
  icon: { kind: 'emoji', value: '🚀' },
  color: null,
};
const key = entityKeys.documentMetadata(entity.id).queryKey;
const original = {
  documentId: entity.id,
  updatedAt: '2026-10-01',
  appearance: null,
};

beforeEach(() => vi.clearAllMocks());

it('patches confirmed appearance without changing recency, and leaves a rejected save untouched', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, original);
  const update = vi
    .fn<UpdateAppearance>()
    .mockResolvedValueOnce(err([]))
    .mockResolvedValueOnce(ok(undefined));
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => undefined,
    update,
  });

  expect((await save(entity, appearance, () => true)).isErr()).toBe(true);
  expect(queryClient.getQueryData(key)).toEqual(original);
  expect(patches.preview).not.toHaveBeenCalled();
  expect(patches.soup).not.toHaveBeenCalled();

  expect((await save(entity, appearance, () => true)).isOk()).toBe(true);
  expect(queryClient.getQueryData(key)).toEqual({ ...original, appearance });
  expect(patches.preview).toHaveBeenCalledWith(entity.id, appearance);
  expect(patches.soup).toHaveBeenCalledWith({
    tag: 'document',
    data: { id: entity.id, appearance },
    frecency_score: 0,
  });
  queryClient.clear();
});

it('does not patch another account when the server commits after an account change', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, original);
  const response = Promise.withResolvers<void>();
  const update = vi.fn<UpdateAppearance>(() =>
    response.promise.then(() => ok(undefined))
  );
  let current = true;
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => undefined,
    update,
  });
  const pending = save(entity, appearance, () => current);
  expect(update).toHaveBeenCalledOnce();
  current = false;
  response.resolve();

  expect((await pending).isOk()).toBe(true);
  expect(queryClient.getQueryData(key)).toEqual(original);
  expect(patches.preview).not.toHaveBeenCalled();
  expect(patches.soup).not.toHaveBeenCalled();
  queryClient.clear();
});

it('keeps a committed write successful when GraphQL cache reconciliation fails', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, original);
  const host = {
    disabled: false,
    writeQuery: vi.fn(async () => {
      throw new Error('cache unavailable');
    }),
  };
  const update = vi.fn<UpdateAppearance>(async () => ok(undefined));
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => host,
    update,
  });

  expect((await save(entity, appearance, () => true)).isOk()).toBe(true);
  expect(update).toHaveBeenCalledOnce();
  expect(host.writeQuery).toHaveBeenCalledOnce();
  expect(queryClient.getQueryData(key)).toEqual({ ...original, appearance });
  queryClient.clear();
});
