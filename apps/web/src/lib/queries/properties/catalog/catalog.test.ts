import type { UrqlQueryResult } from '@app/lib/urql-solid/types';
import { predictOptimisticMutation } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  AddPropertyOptionDocument,
  CreatePropertyDefinitionDocument,
  DeletePropertyDefinitionDocument,
  DeletePropertyOptionDocument,
  type PropertyCatalogDefinitionFieldsFragment,
  type PropertyCatalogOptionFieldsFragment,
  PropertyCatalogOptionsDocument,
  UpdatePropertyOptionDocument,
} from '@service-storage/graphql/generated/graphql';
import { onlineManager } from '@tanstack/solid-query';
import { CombinedError, createRequest } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

/** How each detached task ended: 'ok', or the error fireAndForget would report. */
const DETACHED = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (work: Promise<unknown>) => {
    const outcome = async () => {
      try {
        await work;
        return 'ok';
      } catch (error: unknown) {
        return error;
      }
    };
    DETACHED.push(outcome());
  },
}));

import { CatalogMutationError, isCatalogErrorCode } from './errors';
import {
  catalogListResult,
  createListedAt,
  offlineAsSuccess,
} from './list-result';
import {
  optionValueRecord,
  toAddOptionInput,
  toCreateDefinitionInput,
  toDefinitionWithOptions,
  toPropertyOwner,
  toTagSet,
} from './map';
import { createCatalogMutation } from './mutation';
import { propertyCatalogOptimisticResolvers } from './resolvers';

const EPOCH = new Date(0).toISOString();

function definition(
  overrides: Partial<PropertyCatalogDefinitionFieldsFragment> = {}
): PropertyCatalogDefinitionFieldsFragment {
  return {
    __typename: 'GraphqlPropertyDefinition',
    id: 'def-1',
    owner: { scope: 'USER', principalId: 'macro|viewer@example.test' },
    displayName: 'Stage',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    specificEntityType: null,
    isSystem: false,
    isMetadata: false,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function option(
  id: string,
  displayOrder: number,
  value: string
): PropertyCatalogOptionFieldsFragment {
  return {
    __typename: 'GraphqlPropertyOption',
    id,
    propertyDefinitionId: 'def-1',
    displayOrder,
    value: {
      __typename: 'GraphqlStringPropertyOptionValue',
      stringValue: value,
    },
    color: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

describe('catalog records as REST shapes', () => {
  it('names owners the REST client knew, and none it did not', () => {
    expect(toPropertyOwner({ scope: 'SYSTEM', principalId: null })).toEqual({
      scope: 'system',
    });
    expect(toPropertyOwner({ scope: 'TEAM', principalId: 'team-1' })).toEqual({
      scope: 'team',
      team_id: 'team-1',
    });
    expect(
      toPropertyOwner({ scope: 'USER', principalId: null })
    ).toBeUndefined();
  });

  it('keeps the server order of equal display orders and places moved options', () => {
    const mapped = toDefinitionWithOptions({
      ...definition(),
      options: [option('b', 1, 'B'), option('a', 0, 'A'), option('c', 1, 'C')],
    });
    expect(
      mapped && 'property_options' in mapped
        ? mapped.property_options.map(({ id }) => id)
        : undefined
    ).toEqual(['a', 'b', 'c']);
  });

  it('lists an unprovisioned tag set without a definition and drops an unnamed owner', () => {
    expect(toTagSet({ scope: 'USER', definition: null, options: [] })).toEqual({
      scope: 'user',
      options: [],
    });
    expect(
      toTagSet({
        scope: 'TEAM',
        definition: definition({ owner: { scope: 'TEAM', principalId: null } }),
        options: [],
      })
    ).toBeUndefined();
  });
});

describe('REST requests as GraphQL inputs', () => {
  it('sends a select definition with its options and scope', () => {
    expect(
      toCreateDefinitionInput({
        display_name: 'Stage',
        scope: 'team',
        data_type: {
          type: 'select_string',
          multi: true,
          options: [{ value: 'Open', display_order: 0 }],
        },
      } as never)
    ).toEqual({
      scope: 'TEAM',
      displayName: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: true,
      options: [{ displayOrder: 0, value: { string: 'Open' } }],
    });
  });

  it('refuses a data type this build cannot send', () => {
    expect(() =>
      toCreateDefinitionInput({
        display_name: 'Odd',
        scope: 'user',
        data_type: { type: 'hologram' },
      } as never)
    ).toThrow('Unsupported property type');
  });

  it('sends a number option without a color and a string option with one', () => {
    expect(
      toAddOptionInput('def-1', {
        type: 'select_number',
        option: { value: 3, display_order: 2 },
      })
    ).toEqual({
      propertyDefinitionId: 'def-1',
      displayOrder: 2,
      value: { number: 3 },
    });
    expect(
      toAddOptionInput('def-1', {
        type: 'select_string',
        option: { value: 'Red', display_order: 0, color: '#f00' },
      })
    ).toEqual({
      propertyDefinitionId: 'def-1',
      displayOrder: 0,
      value: { string: 'Red' },
      color: '#f00',
    });
    expect(optionValueRecord({ number: 0 })).toEqual({
      __typename: 'GraphqlNumberPropertyOptionValue',
      numberValue: 0,
    });
  });
});

describe('optimistic resolvers', () => {
  const predict = (
    document: Parameters<typeof predictOptimisticMutation>[1],
    variables: object
  ) =>
    predictOptimisticMutation(
      propertyCatalogOptimisticResolvers,
      document,
      variables
    );

  it('predicts only the fields an option update sends', () => {
    const local = predict(UpdatePropertyOptionDocument, {
      input: {
        propertyDefinitionId: 'def-1',
        optionId: 'opt-1',
        color: '#0f0',
      },
    });
    expect(local?.response).toEqual({
      updatePropertyOption: {
        __typename: 'GraphqlPropertyOption',
        id: 'opt-1',
        color: '#0f0',
      },
    });
  });

  it('hides a deleted option or definition by its record key', () => {
    expect(
      predict(DeletePropertyOptionDocument, {
        propertyDefinitionId: 'def-1',
        optionId: 'opt-1',
      })?.options?.identityBindings
    ).toEqual([
      {
        localKey: 'GraphqlPropertyOption:opt-1',
        responsePath: [],
        deleteRecord: true,
      },
    ]);
    expect(
      predict(DeletePropertyDefinitionDocument, {
        propertyDefinitionId: 'def-1',
      })?.response
    ).toEqual({
      deletePropertyDefinition: {
        __typename: 'GraphqlCacheDeletion',
        graphqlTypeName: 'GraphqlPropertyDefinition',
        entityId: 'def-1',
      },
    });
  });

  it('leaves writes the server answers unpredicted', () => {
    expect(
      predict(AddPropertyOptionDocument, {
        input: {
          propertyDefinitionId: 'def-1',
          displayOrder: 0,
          value: { string: 'A' },
        },
      })
    ).toBeUndefined();
    expect(
      predict(CreatePropertyDefinitionDocument, {
        input: { scope: 'USER', displayName: 'X', dataType: 'STRING' },
      })
    ).toBeUndefined();
  });
});

function fakeQuery(state: {
  data?: string[];
  error?: Error;
  isFetching?: boolean;
}) {
  return {
    get data() {
      return state.data;
    },
    get error() {
      return state.error ?? null;
    },
    get isFetching() {
      return state.isFetching ?? false;
    },
    refetch: vi.fn(async () => undefined),
  } as unknown as UrqlQueryResult<string[], never, never>;
}

describe('catalog list results', () => {
  const EMPTY: string[] = [];
  const NO_STAMP = { listedAt: () => 0, refusal: () => null };

  it('stands in an empty list that reads as successful placeholder data', () => {
    const state: { data?: string[]; error?: Error } = {};
    const list = catalogListResult(fakeQuery(state), NO_STAMP, EMPTY);
    expect(list.data).toBe(EMPTY);
    expect([list.isPending, list.isLoading, list.isSuccess]).toEqual([
      false,
      false,
      true,
    ]);
    expect([list.isPlaceholderData, list.isFetched]).toEqual([true, false]);
    state.data = ['a'];
    expect([list.data, list.isPlaceholderData, list.isFetched]).toEqual([
      ['a'],
      false,
      true,
    ]);
  });

  it('reports a failure while keeping the list it has', () => {
    const state = { data: ['a'], error: new Error('offline') };
    const list = catalogListResult(fakeQuery(state), NO_STAMP, EMPTY);
    expect([list.data, list.isError, list.isSuccess]).toEqual([
      ['a'],
      true,
      false,
    ]);
  });

  it('does not read a failed first read as placeholder data', () => {
    const state: { data?: string[]; error?: Error } = {
      error: new Error('refused'),
    };
    const list = catalogListResult(fakeQuery(state), NO_STAMP, EMPTY);
    expect([
      list.data,
      list.isError,
      list.isPlaceholderData,
      list.isFetched,
    ]).toEqual([EMPTY, true, false, true]);
  });

  describe('a server refusal', () => {
    type Result = Parameters<ReturnType<typeof createListedAt>['onResult']>[0];
    const refused = new CombinedError({
      graphQLErrors: ['property definition is not visible'],
    });
    const keyOf = (id: string) =>
      createRequest(PropertyCatalogOptionsDocument, {
        propertyDefinitionId: id,
      }).key;
    const result = (
      id: string,
      source: string | undefined,
      data: unknown,
      error?: CombinedError
    ) =>
      ({
        operation: { key: keyOf(id) },
        data,
        error,
        extensions:
          source === undefined
            ? undefined
            : { __macroNormalizedCache: { source } },
      }) as unknown as Result;
    const reader = () => {
      const [id, setId] = createSignal<string | undefined>('a');
      const stamp = createListedAt(PropertyCatalogOptionsDocument, () => {
        const value = id();
        return value === undefined
          ? undefined
          : { propertyDefinitionId: value };
      });
      const state: { data?: string[]; error?: Error } = {};
      const list = catalogListResult(fakeQuery(state), stamp, EMPTY);
      return { stamp, state, list, setId };
    };

    it('stands over later cache rereads of the same read', () => {
      createRoot((dispose) => {
        const { stamp, state, list, setId } = reader();

        // The server refuses the read; the cache still holds the old list.
        state.data = ['deleted'];
        state.error = refused;
        stamp.onResult(result('a', 'normalized-cache-hit', {}, refused));
        expect([list.isError, list.error]).toEqual([true, refused]);

        // A write elsewhere rereads the cached list with no error.
        state.error = undefined;
        stamp.onResult(result('a', 'affected-cache-reread', {}));
        stamp.onResult(result('a', 'normalized-cache-patch', {}));
        expect([list.isError, list.isSuccess, list.error]).toEqual([
          true,
          false,
          refused,
        ]);

        // Another read neither inherits the refusal nor, once the server
        // answers it, clears it; switching back shows it before any result.
        setId('b');
        expect(list.isError).toBe(false);
        stamp.onResult(result('b', 'live-network', { user: {} }));
        setId('a');
        expect([list.isError, list.error]).toEqual([true, refused]);

        // A paused reader shows none.
        setId(undefined);
        expect(list.isError).toBe(false);
        setId('a');

        // A refetch that reached no server leaves it standing, offline too.
        onlineManager.setOnline(false);
        try {
          const offline = new CombinedError({
            networkError: new Error('offline'),
          });
          state.error = offline;
          stamp.onResult(result('a', 'live-network', undefined, offline));
          expect([list.isError, list.error]).toEqual([true, refused]);
        } finally {
          onlineManager.setOnline(true);
        }
        state.error = undefined;

        // The server's next successful answer replaces it.
        stamp.onResult(result('a', 'live-network', { user: {} }));
        expect([list.isError, list.error]).toEqual([false, null]);
        dispose();
      });
    });

    it('is cleared by an answer from a client without the cache', () => {
      createRoot((dispose) => {
        const { stamp, list } = reader();
        stamp.onResult(result('a', undefined, undefined, refused));
        expect(list.error).toBe(refused);
        stamp.onResult(result('a', undefined, { user: {} }));
        expect([list.isError, list.error]).toEqual([false, null]);
        dispose();
      });
    });

    it('is not kept for a failure that reached no server', () => {
      createRoot((dispose) => {
        const { stamp, list } = reader();
        stamp.onResult(
          result(
            'a',
            undefined,
            undefined,
            new CombinedError({ networkError: new Error('offline') })
          )
        );
        expect(stamp.refusal()).toBeNull();
        expect(list.error).toBeNull();
        dispose();
      });
    });

    it('is kept for the sixteen reads refused last', () => {
      createRoot((dispose) => {
        const { stamp, setId } = reader();
        const ids = Array.from({ length: 20 }, (_, i) => `d${i}`);
        for (const id of ids)
          stamp.onResult(result(id, 'live-network', undefined, refused));
        const kept = ids.filter((id) => {
          setId(id);
          return stamp.refusal() !== null;
        });
        expect(kept).toEqual(ids.slice(4));
        dispose();
      });
    });
  });

  it('reads an offline failure as a paused read', () => {
    onlineManager.setOnline(false);
    try {
      const offline = new CombinedError({ networkError: new Error('offline') });
      const state: { data?: string[]; error?: Error } = {
        data: ['a'],
        error: offline,
      };
      const list = catalogListResult(fakeQuery(state), NO_STAMP, EMPTY);
      expect([list.data, list.error, list.isSuccess]).toEqual([
        ['a'],
        null,
        true,
      ]);
      // It stays paused until the next result replaces it, as a paused
      // TanStack read stayed successful until it resumed.
      onlineManager.setOnline(true);
      expect(list.isSuccess).toBe(true);
      onlineManager.setOnline(false);
      // A first read made offline stays the placeholder, as a paused
      // TanStack read with placeholder data did, until the app is back.
      state.data = undefined;
      state.error = new CombinedError({ networkError: new Error('offline') });
      expect([
        list.data,
        list.error,
        list.isSuccess,
        list.isPlaceholderData,
        list.isFetched,
      ]).toEqual([EMPTY, null, true, true, false]);
      // A refusal from the server, or an HTTP status from one, still fails.
      state.data = ['a'];
      state.error = new CombinedError({
        graphQLErrors: [{ message: 'forbidden' }],
      });
      expect(list.isError).toBe(true);
      state.error = new CombinedError({
        networkError: new Error('refused'),
        response: { status: 403 },
      });
      expect(list.isError).toBe(true);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('keeps a definitions read made offline pending, as TanStack paused it', () => {
    onlineManager.setOnline(false);
    try {
      const state: { data?: string[]; error?: Error } = {
        error: new CombinedError({ networkError: new Error('offline') }),
      };
      const read = offlineAsSuccess(fakeQuery(state));
      expect([
        read.error,
        read.isError,
        read.isSuccess,
        read.isPending,
        read.isLoading,
        read.status,
      ]).toEqual([null, false, false, true, false, 'pending']);
      state.data = ['a'];
      expect([read.isSuccess, read.status]).toEqual([true, 'success']);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('catalog mutations', () => {
  it('runs default, hook and call callbacks in order and counts pending writes', async () => {
    await createRoot(async (dispose) => {
      const calls: string[] = [];
      let finish: (value: number) => void = () => {};
      const mutation = createCatalogMutation(
        () => new Promise<number>((resolve) => (finish = resolve)),
        {
          onSuccess: () => {
            calls.push('default');
          },
          onSettled: () => {
            calls.push('default settled');
          },
        },
        {
          onSuccess: () => {
            calls.push('hook');
          },
        }
      );
      const done = mutation.mutateAsync(1, {
        onSuccess: () => {
          calls.push('call');
        },
      });
      expect(mutation.isPending).toBe(true);
      finish(7);
      await expect(done).resolves.toBe(7);
      expect(calls).toEqual(['default', 'hook', 'call', 'default settled']);
      expect(mutation.isPending).toBe(false);
      dispose();
    });
  });

  it('reports a refusal through onError; mutate does not reject', async () => {
    await createRoot(async (dispose) => {
      const onError = vi.fn();
      const refused = new CatalogMutationError('taken', 'CONFLICT');
      const mutation = createCatalogMutation(() => Promise.reject(refused), {
        onError,
      });
      mutation.mutate(undefined);
      await vi.waitFor(() =>
        expect(onError).toHaveBeenCalledWith(refused, undefined)
      );
      await expect(mutation.mutateAsync(undefined)).rejects.toBe(refused);
      expect(isCatalogErrorCode(refused, 'CONFLICT')).toBe(true);
      dispose();
    });
  });

  it('reports a callback that fails after mutate, but not the refusal onError had', async () => {
    await createRoot(async (dispose) => {
      DETACHED.length = 0;
      const broken = new Error('callback failed');
      const onError = vi.fn();
      const saves = createCatalogMutation(async () => 1, {
        onSuccess: () => {
          throw broken;
        },
      });
      saves.mutate(undefined);
      const refused = new CatalogMutationError('taken', 'CONFLICT');
      // Refused once, then saved, after which a callback throws the error
      // the first call's write failed with.
      let attempt = 0;
      const retries = createCatalogMutation(
        async () => {
          if (attempt++ === 0) throw refused;
          return 1;
        },
        {
          onError,
          onSettled: (data) => {
            if (data === 1) throw refused;
          },
        }
      );
      retries.mutate(undefined);
      retries.mutate(undefined);
      // A callback that rejects with nothing, and an onError that rethrows
      // the failure it was given, are callback failures too.
      const empty = createCatalogMutation(async () => 1, {
        onSuccess: () => Promise.reject(undefined),
      });
      empty.mutate(undefined);
      const rethrows = createCatalogMutation(() => Promise.reject(refused), {
        onError: (error) => {
          throw error;
        },
      });
      rethrows.mutate(undefined);
      expect(await Promise.all(DETACHED)).toEqual([
        broken,
        'ok',
        refused,
        undefined,
        refused,
      ]);
      expect(onError).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it("drops a call's callbacks once its component is gone, keeping the hook's", async () => {
    const calls: string[] = [];
    let finish: (value: number) => void = () => {};
    const done = createRoot((dispose) => {
      const mutation = createCatalogMutation(
        () => new Promise<number>((resolve) => (finish = resolve)),
        {
          onSuccess: () => {
            calls.push('default');
          },
        },
        {
          onSuccess: () => {
            calls.push('hook');
          },
        }
      );
      const pending = mutation.mutateAsync(1, {
        onSuccess: () => {
          calls.push('call');
        },
      });
      dispose();
      return pending;
    });
    finish(7);
    await expect(done).resolves.toBe(7);
    expect(calls).toEqual(['default', 'hook']);
  });

  it("drops a call's callbacks when its component goes while a hook callback awaits", async () => {
    const calls: string[] = [];
    let release: () => void = () => {};
    let dispose: () => void = () => {};
    const done = createRoot((d) => {
      dispose = d;
      const mutation = createCatalogMutation(async () => 7, {
        onSuccess: async () => {
          calls.push('default');
          await new Promise<void>((resolve) => (release = resolve));
        },
      });
      return mutation.mutateAsync(1, {
        onSuccess: () => {
          calls.push('call');
        },
      });
    });
    await vi.waitFor(() => expect(calls).toEqual(['default']));
    dispose();
    release();
    await expect(done).resolves.toBe(7);
    expect(calls).toEqual(['default']);
  });
});
