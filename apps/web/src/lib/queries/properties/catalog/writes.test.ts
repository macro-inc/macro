import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import type { MutationSettlement } from '@graphql-cache/protocol';
import { onlineManager } from '@tanstack/solid-query';
import { CombinedError, type OperationResult } from '@urql/core';
import { createRoot } from 'solid-js';
import { version as uuidVersion, validate as validateUuid } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const soup = vi.hoisted(() => ({
  result: undefined as Partial<OperationResult> | undefined,
  mutation: vi.fn(),
  host: undefined as
    | {
        onMutationSettled: (
          listener: (settlement: MutationSettlement) => void
        ) => () => void;
        onCacheGenerationChanged: () => () => void;
        readRecordsByKeys: (args: { keys: string[] }) => Promise<unknown>;
        readQuery: () => Promise<unknown>;
      }
    | undefined,
  /** Whether the cache holds the definition's options on its record. */
  definitionCached: true as boolean | 'unreadable',
  settle: (_settlement: MutationSettlement) => {},
  optimistic: vi.fn(),
  reload: undefined as Partial<OperationResult> | undefined,
  /** The client's answer to a cache-only read; nothing when unset. */
  cacheOnly: undefined as Partial<OperationResult> | undefined,
  /** Runs while a cache-only read is answered. */
  duringCacheOnly: undefined as (() => void) | undefined,
  /** The cache store's answers to reads of the tag sets, in order; then a miss. */
  cachedReads: [] as unknown[],
  session: 1,
  /** The cache session generation. */
  epoch: 'gen-1',
  /** Runs while the add reads the cache's records. */
  duringRead: undefined as (() => void) | undefined,
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({
    mutation: soup.mutation,
    query: (
      _document: unknown,
      _variables: unknown,
      context?: { requestPolicy?: string }
    ) => ({
      toPromise: async () => {
        if (context?.requestPolicy === 'network-only')
          return soup.reload ?? { data: undefined };
        if (context?.requestPolicy !== 'cache-only') return { data: undefined };
        soup.duringCacheOnly?.();
        return soup.cacheOnly ?? { data: undefined };
      },
    }),
  }),
  getGraphqlSoupCacheHost: () => soup.host,
}));

vi.mock('@graphql-cache/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@graphql-cache/index')>()),
  executeOptimisticMutation: soup.optimistic,
  optimisticMutationDispositionOf: (result: { queued?: string }) =>
    result.queued
      ? { kind: 'queued', transactionId: result.queued }
      : undefined,
}));

vi.mock('@app/lib/urql-solid/authorization', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@app/lib/urql-solid/authorization')
  >()),
  crmSnapshotAuthorization: () => ({ epoch: soup.epoch, paused: false }),
}));

vi.mock('../../auth/account-scope', () => ({
  queryAccountSession: () => soup.session,
}));

import { CatalogMutationError, isCatalogErrorCode } from './errors';
import { registerCatalogReader } from './readers';
import {
  addPropertyOption,
  cachedTagSet,
  createPropertyDefinition,
  deletePropertyDefinition,
  deletePropertyOption,
  ensureTagSet,
  updatePropertyOption,
} from './writes';

const TAG = {
  type: 'select_string',
  option: { value: 'Lead', display_order: 0, color: '#f00' },
} as const;

beforeEach(() => {
  soup.host = undefined;
  soup.mutation.mockReset();
  soup.mutation.mockImplementation(() => ({
    toPromise: async () => soup.result,
  }));
  soup.optimistic.mockReset();
  soup.reload = undefined;
  soup.cacheOnly = undefined;
  soup.duringCacheOnly = undefined;
  soup.cachedReads = [];
  soup.session = 1;
  soup.definitionCached = true;
  soup.duringRead = undefined;
  soup.epoch = 'gen-1';
});

/** A cache host whose queue holds every write until the test settles it. */
function queueingHost() {
  const listeners = new Set<(settlement: MutationSettlement) => void>();
  let drained = Promise.withResolvers<void>();
  soup.host = {
    onMutationSettled(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) drained.resolve();
      };
    },
    onCacheGenerationChanged: () => () => {},
    readRecordsByKeys: async ({ keys }) => {
      soup.duringRead?.();
      if (soup.definitionCached === 'unreadable')
        throw new Error('cache read timed out');
      return {
        revision: { generation: 0, sequence: 0 },
        records: soup.definitionCached
          ? keys.map((recordKey) => ({ recordKey, record: { options: [] } }))
          : [],
      };
    },
    readQuery: async () => soup.cachedReads.shift() ?? { kind: 'miss' },
  };
  const enqueued = Promise.withResolvers<void>();
  soup.optimistic.mockImplementation(() => {
    enqueued.resolve();
    return { toPromise: async () => ({ queued: 'tx-1' }) };
  });
  return Object.assign(
    (settlement: MutationSettlement) => {
      for (const listener of [...listeners]) listener(settlement);
    },
    {
      /** Resolves once a write is in the queue. */
      enqueued: () => enqueued.promise,
      /** Resolves once no write waits for a settlement: each stops once it has handled its own. */
      drained: async () => {
        if (listeners.size === 0) return;
        drained = Promise.withResolvers<void>();
        await drained.promise;
      },
    }
  );
}

/** The value a write resolves with, or the error it rejects with. */
async function outcomeOf<T>(write: Promise<T>): Promise<unknown> {
  try {
    return await write;
  } catch (error: unknown) {
    return error;
  }
}

describe('adding an option', () => {
  it('sends an id minted here and answers with the option made under it', async () => {
    soup.result = {
      data: {
        addPropertyOption: {
          __typename: 'GraphqlPropertyOption',
          id: 'sent',
          propertyDefinitionId: 'def-1',
          displayOrder: 0,
          value: {
            __typename: 'GraphqlStringPropertyOptionValue',
            stringValue: 'Lead',
          },
          color: '#f00',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      },
    };
    const created = await addPropertyOption('def-1', TAG);
    const [, variables] = soup.mutation.mock.calls[0] ?? [];
    expect(validateUuid(variables.input.id)).toBe(true);
    expect(uuidVersion(variables.input.id)).toBe(7);
    expect(variables.input).toMatchObject({
      propertyDefinitionId: 'def-1',
      value: { string: 'Lead' },
    });
    expect(created.id).toBe('sent');
  });

  it('shows a queued add under its id and resolves only once it commits', async () => {
    const settle = queueingHost();
    let resolved = false;
    const added = (async () => {
      const option = await addPropertyOption('def-1', TAG);
      resolved = true;
      return option;
    })();
    await vi.waitFor(() => expect(soup.optimistic).toHaveBeenCalled());
    const [, , variables, response, options] =
      soup.optimistic.mock.calls[0] ?? [];
    const sent = variables.input.id;
    // The local record is the one the cache shows and links into lists.
    expect(response.addPropertyOption.id).toBe(sent);
    expect(options.uuid).toBe(sent);
    // Linked through the definition's record, so every list holding the
    // definition shows it, mounted or not.
    expect(options.updates).toContainEqual(
      expect.objectContaining({
        recordRoot: expect.objectContaining({
          entityKey: 'GraphqlPropertyDefinition:def-1',
        }),
        path: [{ field: 'options' }],
        operation: {
          kind: 'prependUnique',
          entityKey: `GraphqlPropertyOption:${sent}`,
        },
      })
    );
    await Promise.resolve();
    expect(resolved).toBe(false);
    settle({ transactionId: 'tx-1', status: 'committed' });
    const option = await added;
    expect(option).toMatchObject({
      id: sent,
      property_definition_id: 'def-1',
      value: { type: 'string', value: 'Lead' },
    });
  });

  it('links through the definition only when the cache holds its options', async () => {
    for (const cached of [false, 'unreadable'] as const) {
      soup.optimistic.mockReset();
      queueingHost();
      soup.definitionCached = cached;
      // the queue never settles it here, so the test does not wait for it
      const added = outcomeOf(addPropertyOption('def-1', TAG));
      await vi.waitFor(() => expect(soup.optimistic).toHaveBeenCalled());
      const [, , , , options] = soup.optimistic.mock.calls[0] ?? [];
      // A record link the cache cannot apply would drop every link of the add.
      expect(
        options.updates.some(
          (link: { recordRoot?: unknown }) => link.recordRoot !== undefined
        )
      ).toBe(false);
      expect(options.updates).toHaveLength(1);
      expect(added).toBeInstanceOf(Promise);
    }
  });

  it('drops an add when another login takes over while it reads the cache', async () => {
    queueingHost();
    soup.duringRead = () => {
      soup.session = 2;
    };
    const added = await outcomeOf(addPropertyOption('def-1', TAG));
    expect(isCatalogErrorCode(added, 'ACCOUNT_CHANGED')).toBe(true);
    expect(soup.optimistic).not.toHaveBeenCalled();
  });

  it('stamps an add with the cache generation its links were read under', async () => {
    const settle = queueingHost();
    soup.duringRead = () => {
      soup.epoch = 'gen-2';
    };
    const added = addPropertyOption('def-1', TAG);
    await settle.enqueued();
    const [, , , , options] = soup.optimistic.mock.calls[0] ?? [];
    expect(options).toMatchObject({ authorizationEpoch: 'gen-1' });
    settle({ transactionId: 'tx-1', status: 'committed' });
    await added;
  });

  it('drops a provisioning whose flow began under another login', async () => {
    const provisioned = await outcomeOf(ensureTagSet('user', { session: 0 }));
    expect(isCatalogErrorCode(provisioned, 'ACCOUNT_CHANGED')).toBe(true);
    expect(soup.mutation).not.toHaveBeenCalled();
  });

  it('drops an add whose flow began under another login', async () => {
    queueingHost();
    const added = await outcomeOf(
      addPropertyOption('def-1', TAG, { session: 0 })
    );
    expect(isCatalogErrorCode(added, 'ACCOUNT_CHANGED')).toBe(true);
    expect(soup.optimistic).not.toHaveBeenCalled();
    expect(soup.mutation).not.toHaveBeenCalled();
  });

  it('rejects a queued add the server refuses later', async () => {
    const settle = queueingHost();
    const added = outcomeOf(addPropertyOption('def-1', TAG));
    await vi.waitFor(() => expect(soup.optimistic).toHaveBeenCalled());
    await Promise.resolve();
    settle({
      transactionId: 'tx-1',
      status: 'permanently-failed',
      error: 'refused',
    });
    expect(await added).toBeInstanceOf(Error);
  });

  it('names a refusal made before GraphQL by its HTTP status class', async () => {
    for (const [status, code] of [
      [401, 'UNAUTHENTICATED'],
      [403, 'FORBIDDEN'],
    ] as const) {
      soup.result = {
        error: new CombinedError({
          networkError: new Error('refused'),
          response: { status },
        }),
      };
      const refusal = await addPropertyOption('def-1', TAG).catch(
        (error: unknown) => error
      );
      expect(isCatalogErrorCode(refusal, code)).toBe(true);
    }
  });
});

describe('a write started offline', () => {
  it('waits for the app to come online when the server answers it', async () => {
    onlineManager.setOnline(false);
    try {
      soup.result = { data: { deletePropertyOption: true } };
      const deleted = deletePropertyOption('def-1', 'opt-1', () => {});
      await Promise.resolve();
      await Promise.resolve();
      expect(soup.mutation).not.toHaveBeenCalled();
      onlineManager.setOnline(true);
      await deleted;
      expect(soup.mutation).toHaveBeenCalledTimes(1);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('is sent in the trace it was started in', async () => {
    onlineManager.setOnline(false);
    try {
      soup.result = { data: { deletePropertyOption: true } };
      const deleted = deletePropertyOption('def-1', 'opt-1', () => {});
      onlineManager.setOnline(true);
      await deleted;
      const [, , context] = soup.mutation.mock.calls[0] ?? [];
      expect(context?.[TRACE_PARENT_CONTEXT_KEY]).toBeDefined();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('is dropped when another login took over the page meanwhile', async () => {
    onlineManager.setOnline(false);
    try {
      const created = outcomeOf(
        createPropertyDefinition({
          display_name: 'Stage',
          scope: 'user',
          data_type: { type: 'boolean' },
        })
      );
      await Promise.resolve();
      soup.session = 2;
      onlineManager.setOnline(true);
      expect(isCatalogErrorCode(await created, 'ACCOUNT_CHANGED')).toBe(true);
      expect(soup.mutation).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('goes to the cache queue at once when the cache predicts it', async () => {
    onlineManager.setOnline(false);
    try {
      queueingHost();
      // the queue never settles it here, so the test does not wait for it
      const added = addPropertyOption('def-1', TAG);
      await vi.waitFor(() => expect(soup.optimistic).toHaveBeenCalled());
      expect(added).toBeInstanceOf(Promise);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('provisioning a tag set', () => {
  it('fails when the list it fills cannot be reloaded', async () => {
    queueingHost();
    soup.result = {
      data: {
        ensureTagSet: {
          scope: 'TEAM',
          definition: {
            __typename: 'GraphqlPropertyDefinition',
            id: 'def-team',
            owner: { scope: 'TEAM', principalId: 'team-1' },
            displayName: 'Tags',
            dataType: 'SELECT_STRING',
            isMultiSelect: true,
            specificEntityType: null,
            isSystem: false,
            isMetadata: false,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          },
          options: [],
        },
      },
    };
    soup.reload = {
      error: new CombinedError({ networkError: new Error('unavailable') }),
    };
    const ensured = await ensureTagSet('team').catch((error: unknown) => error);
    expect(ensured).toBeInstanceOf(Error);
  });

  it('is ready only once the cache lists the set', async () => {
    const provisioned = {
      scope: 'TEAM',
      definition: {
        __typename: 'GraphqlPropertyDefinition',
        id: 'def-team',
        owner: { scope: 'TEAM', principalId: 'team-1' },
        displayName: 'Tags',
        dataType: 'SELECT_STRING',
        isMultiSelect: true,
        specificEntityType: null,
        isSystem: false,
        isMetadata: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      options: [],
    };
    const listing = (tagSets: unknown[]) => ({
      kind: 'hit',
      data: { user: { tagSets } },
    });
    for (const [afterReload, ready] of [
      [listing([provisioned]), true],
      // The reload answered, but its cache write did not land.
      [listing([]), false],
      [{ kind: 'miss' }, false],
    ] as const) {
      queueingHost();
      soup.result = { data: { ensureTagSet: provisioned } };
      soup.reload = { data: { user: { tagSets: [provisioned] } } };
      soup.cachedReads = [listing([]), afterReload];
      const ensured = await ensureTagSet('team').catch(
        (error: unknown) => error
      );
      expect(ensured instanceof Error).toBe(!ready);
    }
  });

  it('takes the reload as its answer when the cache cannot answer', async () => {
    const provisioned = {
      scope: 'TEAM',
      definition: {
        __typename: 'GraphqlPropertyDefinition',
        id: 'def-team',
        owner: { scope: 'TEAM', principalId: 'team-1' },
        displayName: 'Tags',
        dataType: 'SELECT_STRING',
        isMultiSelect: true,
        specificEntityType: null,
        isSystem: false,
        isMetadata: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      options: [],
    };
    for (const [reloadLists, ready] of [
      [[provisioned], true],
      [[], false],
    ] as const) {
      queueingHost();
      const host = soup.host;
      if (!host) throw new Error('no host');
      // Every read of the store ends unanswered, as one waiting on another
      // tab's engine does once its bound runs out.
      host.readQuery = async () => {
        throw new Error('cache read ended unanswered');
      };
      soup.result = { data: { ensureTagSet: provisioned } };
      soup.reload = { data: { user: { tagSets: reloadLists } } };
      const ensured = await ensureTagSet('team').catch(
        (error: unknown) => error
      );
      expect(ensured instanceof Error).toBe(!ready);
    }
  });

  it('checks the cache only once the reload is written', async () => {
    const provisioned = {
      scope: 'USER',
      definition: {
        __typename: 'GraphqlPropertyDefinition',
        id: 'def-mine',
        owner: { scope: 'USER', principalId: 'user-1' },
        displayName: 'Tags',
        dataType: 'SELECT_STRING',
        isMultiSelect: true,
        specificEntityType: null,
        isSystem: false,
        isMetadata: false,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
      options: [],
    };
    queueingHost();
    let written = false;
    let persist = (_revision: undefined) => {};
    soup.result = { data: { ensureTagSet: provisioned } };
    soup.reload = {
      data: { user: { tagSets: [provisioned] } },
      extensions: {
        __macroNormalizedCache: {
          source: 'live-network',
          persistence: new Promise<undefined>((resolve) => {
            persist = (revision) => {
              written = true;
              resolve(revision);
            };
          }),
        },
      },
    };
    const reads: boolean[] = [];
    soup.cachedReads = [];
    const host = soup.host;
    if (!host) throw new Error('no host');
    host.readQuery = async () => {
      reads.push(written);
      return {
        kind: 'hit',
        data: { user: { tagSets: written ? [provisioned] : [] } },
      };
    };
    const ensured = ensureTagSet('user');
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    persist(undefined);
    await expect(ensured).resolves.toMatchObject({ scope: 'user' });
    expect(reads).toEqual([false, true]);
  });
});

describe('option order', () => {
  /**
   * Mounted readers. Each reload of a reader is recorded and held until the
   * test releases it; `reloaded(n)` resolves once n reloads have started.
   */
  function mountedReaders() {
    const refreshed: string[] = [];
    const held: Array<() => void> = [];
    const waiters: Array<{ count: number; resolve: () => void }> = [];
    const refresh = (name: string) => () => {
      refreshed.push(name);
      for (const waiter of waiters.filter((w) => refreshed.length >= w.count))
        waiter.resolve();
      return new Promise<void>((resolve) => held.push(resolve));
    };
    const dispose = createRoot((dispose) => {
      registerCatalogReader({
        kind: 'options',
        key: () => 1,
        propertyDefinitionId: () => 'def-1',
        refresh: refresh('options of def-1'),
      });
      registerCatalogReader({
        kind: 'options',
        key: () => 2,
        propertyDefinitionId: () => 'def-2',
        refresh: refresh('options of def-2'),
      });
      registerCatalogReader({
        kind: 'definitions',
        key: () => 3,
        variables: () => ({ scope: 'ALL' }),
        withOptions: true,
        definitionIds: () => ['def-1'],
        refresh: refresh('definitions with options'),
      });
      registerCatalogReader({
        kind: 'definitions',
        key: () => 4,
        variables: () => ({ scope: 'ALL' }),
        withOptions: false,
        definitionIds: () => ['def-1'],
        refresh: refresh('definitions'),
      });
      registerCatalogReader({
        kind: 'tags',
        key: () => 5,
        definitions: () => [{ scope: 'USER', definitionId: 'def-1' }],
        sets: () => [],
        refresh: refresh('tags'),
      });
      return dispose;
    });
    return {
      refreshed,
      reloaded: (count: number) =>
        new Promise<void>((resolve) => {
          if (refreshed.length >= count) resolve();
          else waiters.push({ count, resolve });
        }),
      release: () => {
        for (const resolve of held.splice(0)) resolve();
      },
      dispose: () => {
        for (const resolve of held.splice(0)) resolve();
        dispose();
      },
    };
  }
  const HOLDING_DEF_1 = [
    'options of def-1',
    'definitions with options',
    'tags',
  ].sort();

  it('reloads the lists holding the options once an add commits', async () => {
    const readers = mountedReaders();
    try {
      const settle = queueingHost();
      const added = addPropertyOption('def-1', TAG);
      await vi.waitFor(() => expect(soup.optimistic).toHaveBeenCalled());
      expect(readers.refreshed).toEqual([]);
      settle({ transactionId: 'tx-1', status: 'committed' });
      await added;
      await readers.reloaded(HOLDING_DEF_1.length);
      expect([...readers.refreshed].sort()).toEqual(HOLDING_DEF_1);
    } finally {
      readers.dispose();
    }
  });

  it('reloads them once a rename commits, not for a colour change', async () => {
    const readers = mountedReaders();
    try {
      const settle = queueingHost();
      soup.result = { queued: 'tx-colour' } as Partial<OperationResult>;
      await updatePropertyOption('def-1', 'opt-1', { color: '#0f0' }, () => {});
      soup.result = { queued: 'tx-rename' } as Partial<OperationResult>;
      await updatePropertyOption('def-1', 'opt-1', { value: 'B' }, () => {});
      // The colour change commits first; only the rename reloads.
      settle({ transactionId: 'tx-colour', status: 'committed' });
      settle({ transactionId: 'tx-rename', status: 'committed' });
      await readers.reloaded(HOLDING_DEF_1.length);
      expect([...readers.refreshed].sort()).toEqual(HOLDING_DEF_1);
    } finally {
      readers.dispose();
    }
  });

  it('reloads once more for every write that commits during a reload', async () => {
    const readers = mountedReaders();
    try {
      const settle = queueingHost();
      for (const tx of ['tx-a', 'tx-b', 'tx-c']) {
        soup.result = { queued: tx } as Partial<OperationResult>;
        await updatePropertyOption('def-1', 'opt-1', { value: tx }, () => {});
      }
      settle({ transactionId: 'tx-a', status: 'committed' });
      await readers.reloaded(HOLDING_DEF_1.length);
      // Two more commits while the first reload runs.
      settle({ transactionId: 'tx-b', status: 'committed' });
      settle({ transactionId: 'tx-c', status: 'committed' });
      // Both commits have reached the coalescer once their writes stop waiting.
      await settle.drained();
      // The trailing reload waits for the one running.
      expect(readers.refreshed).toHaveLength(HOLDING_DEF_1.length);
      readers.release();
      await readers.reloaded(2 * HOLDING_DEF_1.length);
      readers.release();
      expect([...readers.refreshed].sort()).toEqual(
        [...HOLDING_DEF_1, ...HOLDING_DEF_1].sort()
      );
    } finally {
      readers.dispose();
    }
  });

  it('still reloads for a write that commits while a failing reload runs', async () => {
    let fail: (error: Error) => void = () => {};
    const reloads: string[] = [];
    let second: () => void = () => {};
    const secondStarted = new Promise<void>((resolve) => {
      second = resolve;
    });
    const dispose = createRoot((dispose) => {
      registerCatalogReader({
        kind: 'options',
        key: () => 6,
        propertyDefinitionId: () => 'def-1',
        refresh: () => {
          reloads.push('def-1');
          return new Promise<void>((_, reject) => {
            fail = reject;
          });
        },
      });
      registerCatalogReader({
        kind: 'options',
        key: () => 7,
        propertyDefinitionId: () => 'def-2',
        refresh: async () => {
          reloads.push('def-2');
          second();
        },
      });
      return dispose;
    });
    try {
      const settle = queueingHost();
      soup.result = { queued: 'tx-1' } as Partial<OperationResult>;
      await updatePropertyOption('def-1', 'opt-1', { value: 'A' }, () => {});
      soup.result = { queued: 'tx-2' } as Partial<OperationResult>;
      await updatePropertyOption('def-2', 'opt-2', { value: 'B' }, () => {});
      settle({ transactionId: 'tx-1', status: 'committed' });
      await vi.waitFor(() => expect(reloads).toEqual(['def-1']));
      settle({ transactionId: 'tx-2', status: 'committed' });
      fail(new Error('unavailable'));
      await secondStarted;
      expect(reloads).toEqual(['def-1', 'def-2']);
    } finally {
      dispose();
    }
  });
});

describe('a write the cache never hands to an engine', () => {
  // The cache refuses such a write after 30 s as not admitted: an error with
  // no queue disposition. No engine applied its optimistic layer, so the
  // cache has nothing to roll back; the write must fail, once, and nothing
  // may treat it as committed.
  const NOT_ADMITTED_MS = 30_000;
  const notAdmitted = () =>
    new Promise<Partial<OperationResult>>((resolve) =>
      setTimeout(
        () =>
          resolve({
            error: new CombinedError({
              networkError: new Error('mutation not admitted'),
            }),
          }),
        NOT_ADMITTED_MS
      )
    );

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Runs a write to its refusal; whether it settled early, and how. */
  async function refused(write: () => Promise<unknown>) {
    let settledEarly = false;
    const outcome = (async () => {
      const value = await outcomeOf(write());
      settledEarly = true;
      return value;
    })();
    await vi.advanceTimersByTimeAsync(NOT_ADMITTED_MS - 1);
    const early = settledEarly;
    await vi.advanceTimersByTimeAsync(1);
    return { early, outcome: await outcome };
  }

  it('fails an add, with no reload and no second send', async () => {
    const refreshed = vi.fn(async () => {});
    const dispose = createRoot((dispose) => {
      registerCatalogReader({
        kind: 'options',
        key: () => 1,
        propertyDefinitionId: () => 'def-1',
        refresh: refreshed,
      });
      return dispose;
    });
    try {
      queueingHost();
      soup.optimistic.mockImplementation(() => ({ toPromise: notAdmitted }));
      const { early, outcome } = await refused(() =>
        addPropertyOption('def-1', TAG)
      );
      expect(early).toBe(false);
      expect(outcome).toBeInstanceOf(CatalogMutationError);
      expect(soup.optimistic).toHaveBeenCalledTimes(1);
      expect(soup.mutation).not.toHaveBeenCalled();
      expect(refreshed).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('fails a write the cache predicts, reporting it once', async () => {
    for (const write of [
      (late: (error: Error) => void) =>
        updatePropertyOption('def-1', 'opt-1', { value: 'Renamed' }, late),
      (late: (error: Error) => void) =>
        deletePropertyOption('def-1', 'opt-1', late),
      (late: (error: Error) => void) => deletePropertyDefinition('def-1', late),
    ]) {
      queueingHost();
      soup.mutation.mockReset();
      soup.mutation.mockImplementation(() => ({ toPromise: notAdmitted }));
      const late = vi.fn();
      const { early, outcome } = await refused(() => write(late));
      expect(early).toBe(false);
      expect(outcome).toBeInstanceOf(CatalogMutationError);
      // The caller's failure handler hears the rejection; the late-failure
      // path would report it a second time.
      expect(late).not.toHaveBeenCalled();
      expect(soup.mutation).toHaveBeenCalledTimes(1);
    }
  });

  it('fails a write the server answers', async () => {
    for (const write of [
      () =>
        createPropertyDefinition({
          display_name: 'Stage',
          data_type: { type: 'string' },
          scope: 'user',
        } as Parameters<typeof createPropertyDefinition>[0]),
      () => ensureTagSet('user'),
    ]) {
      queueingHost();
      soup.mutation.mockReset();
      soup.mutation.mockImplementation(() => ({ toPromise: notAdmitted }));
      const { early, outcome } = await refused(write);
      expect(early).toBe(false);
      expect(outcome).toBeInstanceOf(CatalogMutationError);
      expect(soup.mutation).toHaveBeenCalledTimes(1);
    }
  });
});

describe('provisioning while the cache cannot answer', () => {
  const provisioned = {
    scope: 'USER',
    definition: {
      __typename: 'GraphqlPropertyDefinition',
      id: 'def-mine',
      owner: { scope: 'USER', principalId: 'user-1' },
      displayName: 'Tags',
      dataType: 'SELECT_STRING',
      isMultiSelect: true,
      specificEntityType: null,
      isSystem: false,
      isMetadata: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    options: [],
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the cache back once its reload is written, or after 10 s', async () => {
    vi.useFakeTimers();
    queueingHost();
    soup.result = { data: { ensureTagSet: provisioned } };
    soup.reload = {
      data: { user: { tagSets: [provisioned] } },
      extensions: {
        __macroNormalizedCache: {
          source: 'live-network',
          // The reload's write never reports back.
          persistence: new Promise<undefined>(() => {}),
        },
      },
    };
    soup.cachedReads = [
      { kind: 'miss' },
      { kind: 'hit', data: { user: { tagSets: [provisioned] } } },
    ];
    let done = false;
    const ensured = (async () => {
      const value = await ensureTagSet('user');
      done = true;
      return value;
    })();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(ensured).resolves.toMatchObject({ scope: 'user' });
  });

  it('takes the set a tag list shows when the cache answers nothing', async () => {
    queueingHost();
    const shown = {
      scope: 'team',
      definition: { id: 'def-team' },
      options: [],
    } as unknown as Awaited<ReturnType<typeof ensureTagSet>>;
    let failed = false;
    const dispose = createRoot((dispose) => {
      registerCatalogReader({
        kind: 'tags',
        key: () => 7,
        definitions: () => [{ scope: 'TEAM', definitionId: 'def-team' }],
        sets: () => (failed ? [] : [shown]),
        refresh: async () => {},
      });
      return dispose;
    });
    try {
      // Not from a failed list, even when the cache read's miss reaches the
      // list and clears its error.
      failed = true;
      soup.duringCacheOnly = () => {
        failed = false;
      };
      expect(await cachedTagSet('team')).toBeUndefined();
      soup.duringCacheOnly = undefined;
      expect(await cachedTagSet('team')).toBe(shown);
      expect(await cachedTagSet('user')).toBeUndefined();
      // Not for a flow another login took over.
      expect(await cachedTagSet('team', soup.session - 1)).toBeUndefined();
      // Nor when the cache answers that the set is not provisioned.
      soup.cacheOnly = {
        data: {
          user: { tagSets: [{ scope: 'TEAM', definition: null, options: [] }] },
        },
      };
      expect(await cachedTagSet('team')).toBeUndefined();
    } finally {
      dispose();
    }
  });
});
