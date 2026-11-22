import type { UrqlQueryResult } from '@app/lib/urql-solid/types';
import { predictOptimisticMutation } from '@graphql-cache/exchange/optimistic-resolvers';
import {
  AddPropertyOptionDocument,
  CreatePropertyDefinitionDocument,
  DeletePropertyDefinitionDocument,
  DeletePropertyOptionDocument,
  type PropertyCatalogDefinitionFieldsFragment,
  type PropertyCatalogOptionFieldsFragment,
  UpdatePropertyOptionDocument,
} from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { CatalogMutationError, isCatalogErrorCode } from './errors';
import { catalogListResult } from './list-result';
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

  it('stands in an empty list that reads as successful placeholder data', () => {
    const state: { data?: string[]; error?: Error } = {};
    const list = catalogListResult(fakeQuery(state), () => 0, EMPTY);
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
    const list = catalogListResult(fakeQuery(state), () => 0, EMPTY);
    expect([list.data, list.isError, list.isSuccess]).toEqual([
      ['a'],
      true,
      false,
    ]);
  });

  it('reads an offline failure over a list it has as a paused success', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const offline = new CombinedError({ networkError: new Error('offline') });
      const state: { data?: string[]; error?: Error } = {
        data: ['a'],
        error: offline,
      };
      const list = catalogListResult(fakeQuery(state), () => 0, EMPTY);
      expect([list.data, list.error, list.isSuccess]).toEqual([
        ['a'],
        null,
        true,
      ]);
      // With nothing to show, or a refusal from the server, it still fails.
      state.data = undefined;
      expect(list.isError).toBe(true);
      state.data = ['a'];
      state.error = new CombinedError({
        graphQLErrors: [{ message: 'forbidden' }],
      });
      expect(list.isError).toBe(true);
    } finally {
      online.mockRestore();
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
});
