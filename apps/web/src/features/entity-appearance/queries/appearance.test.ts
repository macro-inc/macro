import type { CacheHost } from '@graphql-cache/index';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import { entityKeys, formsKeys } from '@queries/storage/keys';
import type { EntityAppearanceCacheWriteSubscription } from '@service-storage/graphql/generated/graphql';
import { QueryClient } from '@tanstack/solid-query';
import { buildSchema, execute, parse } from 'graphql';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import schemaSdl from '../../../../../../static_assets/schema.graphql?raw';
import type { DocumentEntity, FormEntity } from '../../entity/types/entity';
import {
  type EntityAppearance,
  readEntityAppearance,
  sameAppearance,
} from '../core/appearance';
import { createSaveEntityAppearance } from './appearance';

const schema = buildSchema(schemaSdl);

async function writtenAppearance(
  write: Parameters<CacheHost['writeQuery']>[0]
) {
  const result = await execute({
    schema,
    document: parse(write.query),
    operationName: write.operationName,
    rootValue: write.data,
  });
  expect(result.errors).toBeUndefined();
  const data = result.data as EntityAppearanceCacheWriteSubscription;
  const change = data.soupUpdates[0];
  if (change?.__typename !== 'SoupUpdated' || !('appearance' in change.item))
    throw new Error('Expected an appearance update');
  return readEntityAppearance(change.item.appearance);
}

type UpdateAppearance = Parameters<
  typeof createSaveEntityAppearance
>[0]['update'];
const patches = vi.hoisted(() => ({
  preview: vi.fn(),
  soup: vi.fn(),
  soupRecord: vi.fn(),
}));
vi.mock('@queries/preview', () => ({ setPreviewAppearance: patches.preview }));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: patches.soupRecord,
  hydrateSoupEntity: patches.soup,
  optimisticUpdateSoupEntity: patches.soup,
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
const second: EntityAppearance = {
  icon: { kind: 'emoji', value: '🌿' },
  color: 'green',
};
const key = entityKeys.documentMetadata(entity.id).queryKey;
const original = {
  documentId: entity.id,
  updatedAt: '2026-10-01',
  appearance: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  patches.soupRecord.mockReturnValue({
    tag: 'document',
    data: { id: entity.id, appearance: null },
    frecency_score: 0,
  });
});

it('patches readers before REST resolves and restores only appearance on failure', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, original);
  const response =
    Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
  const started = Promise.withResolvers<void>();
  const update = vi.fn<UpdateAppearance>(() => {
    started.resolve();
    return response.promise;
  });
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => undefined,
    update,
  });
  const pending = save(entity, appearance, () => true);
  await started.promise;
  expect(queryClient.getQueryData(key)).toEqual({ ...original, appearance });
  expect(patches.preview).toHaveBeenCalledWith(entity.id, appearance);
  expect(patches.soup).toHaveBeenCalledWith({
    tag: 'document',
    data: { id: entity.id, appearance },
    frecency_score: 0,
  });
  queryClient.setQueryData(key, {
    ...original,
    appearance,
    updatedAt: '2026-11-01',
  });
  response.resolve(err([]));
  expect((await pending).isErr()).toBe(true);
  expect(queryClient.getQueryData(key)).toEqual({
    ...original,
    updatedAt: '2026-11-01',
  });
  queryClient.clear();
});

it('does not roll back caches belonging to a new account', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, original);
  const response =
    Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
  const started = Promise.withResolvers<void>();
  let current = true;
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => undefined,
    update: () => {
      started.resolve();
      return response.promise;
    },
  });
  const pending = save(entity, appearance, () => current);
  await started.promise;
  current = false;
  queryClient.setQueryData(key, original);
  response.resolve(err([]));
  expect((await pending).isErr()).toBe(true);
  expect(queryClient.getQueryData(key)).toEqual(original);
  queryClient.clear();
});

it('unwinds overlapping failed edits without losing an earlier successful edit', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, original);
  const first = Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
  const later = Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
  const firstStarted = Promise.withResolvers<void>();
  const laterStarted = Promise.withResolvers<void>();
  const update = vi
    .fn<UpdateAppearance>()
    .mockImplementationOnce(() => {
      firstStarted.resolve();
      return first.promise;
    })
    .mockImplementationOnce(() => {
      laterStarted.resolve();
      return later.promise;
    });
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => undefined,
    update,
  });
  const pendingFirst = save(entity, appearance, () => true);
  await firstStarted.promise;
  const patched = Promise.withResolvers<void>();
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success')
      patched.resolve();
  });
  const pendingLater = save(entity, second, () => true);
  await patched.promise;
  unsubscribe();
  expect(update).toHaveBeenCalledTimes(1);
  expect(queryClient.getQueryData(key)).toEqual({
    ...original,
    appearance: second,
  });
  first.resolve(ok(undefined));
  expect((await pendingFirst).isOk()).toBe(true);
  await laterStarted.promise;
  later.resolve(err([]));
  expect((await pendingLater).isErr()).toBe(true);
  expect(queryClient.getQueryData(key)).toEqual({ ...original, appearance });
  queryClient.clear();
});

it.each([true, false])(
  'keeps ordered server state when the older save succeeds: %s',
  async (olderSucceeds) => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, original);
    const started = Promise.withResolvers<void>();
    const response =
      Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
    let stored: EntityAppearance | undefined;
    const update = vi
      .fn<UpdateAppearance>()
      .mockImplementationOnce(async (_type, _id, next) => {
        started.resolve();
        const result = await response.promise;
        if (result.isOk()) stored = next;
        return result;
      })
      .mockImplementationOnce(async (_type, _id, next) => {
        stored = next;
        return ok(undefined);
      });
    const save = createSaveEntityAppearance({
      queryClient,
      cacheHost: () => undefined,
      update,
    });
    const first = save(entity, appearance, () => true);
    await started.promise;
    const patched = Promise.withResolvers<void>();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success')
        patched.resolve();
    });
    // Identical values also need protection against the failed earlier rollback.
    const latest = olderSucceeds ? second : appearance;
    const later = save(entity, latest, () => true);
    await patched.promise;
    unsubscribe();
    expect(queryClient.getQueryData(key)).toEqual({
      ...original,
      appearance: latest,
    });
    expect(update).toHaveBeenCalledTimes(1);
    response.resolve(olderSucceeds ? ok(undefined) : err([]));
    await Promise.all([first, later]);
    expect(update).toHaveBeenCalledTimes(2);
    expect(stored).toEqual(latest);
    expect(queryClient.getQueryData(key)).toEqual({
      ...original,
      appearance: latest,
    });
    queryClient.clear();
  }
);

it('cancels pending list reads and patches form detail and both list shapes', async () => {
  const queryClient = new QueryClient();
  const form = { id: 'form-1', appearance: null, name: 'Form' };
  const detail = formsKeys.detail(form.id).queryKey;
  const list = formsKeys.list.queryKey;
  const database = formsKeys.forDatabase('db-1').queryKey;
  queryClient.setQueryData(detail, { form, permissions: { canEdit: true } });
  queryClient.setQueryData(list, [{ form, updatedAt: 'today' }]);
  queryClient.setQueryData(database, [form]);
  const cancel = vi.spyOn(queryClient, 'cancelQueries');
  const response =
    Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
  const started = Promise.withResolvers<void>();
  const update = vi.fn<UpdateAppearance>(() => {
    started.resolve();
    return response.promise;
  });
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => undefined,
    update,
  });
  const pending = save(
    {
      ...entity,
      id: form.id,
      type: 'form',
      access: 'owner',
    } satisfies FormEntity,
    appearance,
    () => true
  );
  await started.promise;
  expect(cancel).toHaveBeenCalledWith(
    expect.objectContaining({ queryKey: formsKeys.forDatabase._def })
  );
  expect(queryClient.getQueryData(detail)).toMatchObject({
    form: { appearance },
    permissions: { canEdit: true },
  });
  expect(queryClient.getQueryData(list)).toMatchObject([
    { form: { appearance }, updatedAt: 'today' },
  ]);
  expect(queryClient.getQueryData(database)).toMatchObject([{ appearance }]);
  response.resolve(err([]));
  expect((await pending).isErr()).toBe(true);
  expect(queryClient.getQueryData(detail)).toEqual({
    form,
    permissions: { canEdit: true },
  });
  expect(queryClient.getQueryData(list)).toEqual([
    { form, updatedAt: 'today' },
  ]);
  expect(queryClient.getQueryData(database)).toEqual([form]);
  queryClient.clear();
});

it('keeps a committed REST write successful when GraphQL cache reconciliation fails', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, original);
  const host = {
    disabled: false,
    readRecordsByKeys: vi.fn(async () => ({
      revision: INITIAL_CACHE_REVISION,
      records: [
        {
          recordKey: `GraphqlSoupDocument:${entity.id}`,
          record: {
            __typename: 'GraphqlSoupDocument',
            id: entity.id,
            documentName: 'Document',
            fileType: 'md',
            subType: null,
            appearance: null,
          },
        },
      ],
    })),
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
  expect(host.writeQuery).toHaveBeenCalledTimes(2);
  expect(queryClient.getQueryData(key)).toEqual({ ...original, appearance });
  queryClient.clear();
});

it.each(['document', 'initiative'] as const)(
  'repairs a stale %s cache response received before REST confirmation',
  async (type) => {
    const queryClient = new QueryClient();
    const patched = Promise.withResolvers<void>();
    const response =
      Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
    const record = {
      __typename:
        type === 'document' ? 'GraphqlSoupDocument' : 'GraphqlSoupInitiative',
      id: entity.id,
      appearance: null as EntityAppearance | null,
    };
    const events: string[] = [];
    const host = {
      disabled: false,
      readRecordsByKeys: vi.fn(async () => ({
        revision: INITIAL_CACHE_REVISION,
        records: [
          {
            recordKey: `${record.__typename}:${record.id}`,
            record: { ...record },
          },
        ],
      })),
      writeQuery: vi.fn<CacheHost['writeQuery']>(async (write) => {
        record.appearance = await writtenAppearance(write);
        events.push('write');
        patched.resolve();
        return {
          revision: INITIAL_CACHE_REVISION,
          revisionAdvanced: true,
          changed: [],
          affectedOps: [],
          reset: false,
        };
      }),
    };
    const acknowledgeWrite = vi.fn(() => events.push('acknowledge'));
    const refreshUncached = vi.fn();
    const save = createSaveEntityAppearance({
      queryClient,
      cacheHost: () => host,
      update: () => response.promise,
      acknowledgeWrite,
      refreshUncached,
    });
    const target =
      type === 'document'
        ? entity
        : { type, id: entity.id, name: entity.name, ownerId: entity.ownerId };
    const pending = save(target, appearance, () => true);
    await patched.promise;
    expect(record.appearance).toEqual(appearance);
    expect(acknowledgeWrite).not.toHaveBeenCalled();
    // An older read can already have published while the REST write is pending.
    record.appearance = null;
    response.resolve(ok(undefined));
    expect((await pending).isOk()).toBe(true);
    expect(record.appearance).toEqual(appearance);
    expect(events).toEqual(['write', 'acknowledge', 'write']);
    expect(acknowledgeWrite).toHaveBeenCalledWith(host);
    expect(refreshUncached).not.toHaveBeenCalled();
    queryClient.clear();
  }
);

it.each(['document', 'initiative'] as const)(
  'updates a cached %s without requiring unrelated preview fields',
  async (type) => {
    const queryClient = new QueryClient();
    const patched = Promise.withResolvers<void>();
    const response =
      Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
    const record = {
      __typename:
        type === 'document' ? 'GraphqlSoupDocument' : 'GraphqlSoupInitiative',
      id: entity.id,
      appearance: null as EntityAppearance | null,
    };
    const host = {
      disabled: false,
      readRecordsByKeys: vi.fn<CacheHost['readRecordsByKeys']>(
        async ({ document }) => ({
          revision: INITIAL_CACHE_REVISION,
          // The engine cannot project a preview when only appearance is loaded.
          records: document.includes('displayName')
            ? []
            : [
                {
                  recordKey: `${record.__typename}:${record.id}`,
                  record: { ...record },
                },
              ],
        })
      ),
      writeQuery: vi.fn<CacheHost['writeQuery']>(async (write) => {
        try {
          record.appearance = await writtenAppearance(write);
        } finally {
          patched.resolve();
        }
        return {
          revision: INITIAL_CACHE_REVISION,
          revisionAdvanced: true,
          changed: [],
          affectedOps: [],
          reset: false,
        };
      }),
    };
    const save = createSaveEntityAppearance({
      queryClient,
      cacheHost: () => host,
      update: () => response.promise,
    });
    const target =
      type === 'document'
        ? entity
        : { type, id: entity.id, name: entity.name, ownerId: entity.ownerId };
    const pending = save(target, appearance, () => true);
    await patched.promise;
    expect(record.appearance).toEqual(appearance);
    response.resolve(err([]));
    expect((await pending).isErr()).toBe(true);
    expect(record.appearance).toBeNull();
    queryClient.clear();
  }
);

it.each([true, false])(
  'settles overlapping normalized cache edits when the older save succeeds=%s',
  async (olderSucceeds) => {
    const queryClient = new QueryClient();
    const response =
      Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
    const later =
      Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
    const firstPatched = Promise.withResolvers<void>();
    const secondPatched = Promise.withResolvers<void>();
    const record = {
      __typename: 'GraphqlSoupDocument',
      id: entity.id,
      appearance: null as EntityAppearance | null,
      displayName: 'Document',
      documentName: 'Document',
      fileType: 'md',
      subType: null,
      viewerPermission: { accessLevel: 'EDIT' },
    };
    const host = {
      disabled: false,
      readRecordsByKeys: vi.fn(async () => ({
        revision: INITIAL_CACHE_REVISION,
        records: [{ recordKey: `GraphqlSoupDocument:${entity.id}`, record }],
      })),
      writeQuery: vi.fn<CacheHost['writeQuery']>(async (write) => {
        record.appearance = await writtenAppearance(write);
        if (sameAppearance(record.appearance, appearance))
          firstPatched.resolve();
        if (sameAppearance(record.appearance, second)) secondPatched.resolve();
        return {
          revision: INITIAL_CACHE_REVISION,
          revisionAdvanced: true,
          changed: [],
          affectedOps: [],
          reset: false,
        };
      }),
    };
    const update = vi
      .fn<UpdateAppearance>()
      .mockImplementationOnce(() => response.promise)
      .mockImplementationOnce(() => later.promise);
    const save = createSaveEntityAppearance({
      queryClient,
      cacheHost: () => host,
      update,
    });
    const pending = save(entity, appearance, () => true);
    await firstPatched.promise;
    expect(record.appearance).toEqual(appearance);
    expect(record.viewerPermission).toEqual({ accessLevel: 'EDIT' });
    const pendingLater = save(entity, second, () => true);
    await secondPatched.promise;
    expect(record.appearance).toEqual(second);
    response.resolve(olderSucceeds ? ok(undefined) : err([]));
    expect((await pending).isOk()).toBe(olderSucceeds);
    expect(record.appearance).toEqual(second);
    later.resolve(err([]));
    expect((await pendingLater).isErr()).toBe(true);
    expect(record.appearance).toEqual(olderSucceeds ? appearance : null);
    expect(record.viewerPermission).toEqual({ accessLevel: 'EDIT' });
    queryClient.clear();
  }
);

it('does not roll back a Soup entity that was absent when the edit began', async () => {
  const queryClient = new QueryClient();
  patches.soupRecord.mockReturnValue(undefined);
  const started = Promise.withResolvers<void>();
  const response =
    Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => undefined,
    update: () => {
      started.resolve();
      return response.promise;
    },
  });
  const pending = save(entity, appearance, () => true);
  await started.promise;
  patches.soupRecord.mockReturnValue({
    tag: 'document',
    data: { id: entity.id, appearance },
    frecency_score: 0,
  });
  response.resolve(err([]));
  await pending;
  expect(patches.soup).not.toHaveBeenCalled();
  queryClient.clear();
});

it('does not send queued writes after the account changes', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, original);
  const started = Promise.withResolvers<void>();
  const response =
    Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
  const update = vi.fn<UpdateAppearance>(() => {
    started.resolve();
    return response.promise;
  });
  let current = true;
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => undefined,
    update,
  });
  const first = save(entity, appearance, () => current);
  await started.promise;
  const patched = Promise.withResolvers<void>();
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success')
      patched.resolve();
  });
  const secondSave = save(entity, second, () => current);
  await patched.promise;
  unsubscribe();
  current = false;
  queryClient.setQueryData(key, original);
  response.resolve(ok(undefined));
  const results = await Promise.all([first, secondSave]);
  expect(results[1].isErr()).toBe(true);
  expect(update).toHaveBeenCalledOnce();
  expect(queryClient.getQueryData(key)).toEqual(original);
  queryClient.clear();
});

it('leaves a cold initial reader running when appearance is applied', async () => {
  const queryClient = new QueryClient();
  const readerStarted = Promise.withResolvers<void>();
  const readerResponse = Promise.withResolvers<typeof original>();
  const read = queryClient.fetchQuery({
    queryKey: key,
    queryFn: () => {
      readerStarted.resolve();
      return readerResponse.promise;
    },
  });
  await readerStarted.promise;
  const writeStarted = Promise.withResolvers<void>();
  const response =
    Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => undefined,
    update: () => {
      writeStarted.resolve();
      return response.promise;
    },
  });
  const pending = save(entity, appearance, () => true);
  await writeStarted.promise;
  expect(queryClient.getQueryState(key)?.fetchStatus).toBe('fetching');
  readerResponse.resolve(original);
  await read;
  response.resolve(err([]));
  await pending;
  expect(queryClient.getQueryState(key)?.status).toBe('success');
  queryClient.clear();
});

it.each(['read-first', 'save-first'])(
  'keeps confirmed appearance when a cold read finishes %s',
  async (order) => {
    const queryClient = new QueryClient();
    const readStarted = Promise.withResolvers<void>();
    const readResponse = Promise.withResolvers<typeof original>();
    const read = queryClient.fetchQuery({
      queryKey: key,
      queryFn: () => {
        readStarted.resolve();
        return readResponse.promise;
      },
    });
    await readStarted.promise;
    const started = Promise.withResolvers<void>();
    const response =
      Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
    const save = createSaveEntityAppearance({
      queryClient,
      cacheHost: () => undefined,
      update: () => {
        started.resolve();
        return response.promise;
      },
    });
    const reconciled = Promise.withResolvers<void>();
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const icon = queryClient.getQueryData<{ appearance?: EntityAppearance }>(
        key
      )?.appearance?.icon;
      if (icon?.kind === 'emoji' && icon.value === '🚀') reconciled.resolve();
    });
    const pending = save(entity, appearance, () => true);
    await started.promise;
    if (order === 'read-first') {
      readResponse.resolve(original);
      await read;
      response.resolve(ok(undefined));
      await pending;
    } else {
      response.resolve(ok(undefined));
      await pending;
      readResponse.resolve(original);
      await read;
    }
    await reconciled.promise;
    expect(queryClient.getQueryData(key)).toEqual({ ...original, appearance });
    unsubscribe();
    queryClient.clear();
  }
);

it('does not recreate a deleted GraphQL record when a reset fails', async () => {
  const queryClient = new QueryClient();
  const patched = Promise.withResolvers<void>();
  const response =
    Promise.withResolvers<Awaited<ReturnType<UpdateAppearance>>>();
  let present = true;
  const record = {
    __typename: 'GraphqlSoupDocument',
    id: entity.id,
    documentName: 'Document',
    fileType: 'md',
    subType: null,
    appearance,
  };
  const host = {
    disabled: false,
    readRecordsByKeys: vi.fn(async () => ({
      revision: INITIAL_CACHE_REVISION,
      records: present
        ? [{ recordKey: `GraphqlSoupDocument:${entity.id}`, record }]
        : [],
    })),
    writeQuery: vi.fn<CacheHost['writeQuery']>(async () => {
      patched.resolve();
      return {
        revision: INITIAL_CACHE_REVISION,
        revisionAdvanced: true,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    }),
  };
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => host,
    update: () => response.promise,
  });
  const pending = save(entity, { icon: null, color: null }, () => true);
  await patched.promise;
  present = false;
  response.resolve(err([]));
  expect((await pending).isErr()).toBe(true);
  expect(host.writeQuery).toHaveBeenCalledOnce();
  queryClient.clear();
});

it('does not leave an unconfirmed appearance in a previously absent GraphQL record', async () => {
  const queryClient = new QueryClient();
  const host = {
    disabled: false,
    readRecordsByKeys: vi.fn(async () => ({
      revision: INITIAL_CACHE_REVISION,
      records: [],
    })),
    writeQuery: vi.fn<CacheHost['writeQuery']>(),
  };
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => host,
    update: async () => err([]),
  });
  expect((await save(entity, appearance, () => true)).isErr()).toBe(true);
  expect(host.writeQuery).not.toHaveBeenCalled();
  queryClient.clear();
});
