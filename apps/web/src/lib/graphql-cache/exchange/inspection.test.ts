import {
  GroupSoupMembershipDocument,
  type GroupSoupMembershipQuery,
  type GroupSoupMembershipQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createNoopCacheHost } from '../host/noop-host';
import type { CacheHost } from '../host/types';
import { inspect, selectAll } from './inspection';

const input = {
  initial: {
    groupBy: {
      field: 'PROPERTY' as const,
      propertyDefinitionId: 'status-def',
    },
    limit: 20,
  },
};

describe('typed generated query inspection', () => {
  it('serializes only the document, operation name, and field path', async () => {
    const inspectQuery = async (request: unknown) => {
      expect(request).toMatchObject({
        operationName: 'GroupSoupMembership',
        path: [{ field: 'user' }, { field: 'groupSoup' }],
      });
      expect(request).not.toHaveProperty('variables');
      expect(request).not.toHaveProperty('entityKey');
      return [
        {
          variables: { input },
          value: { bins: [{ key: 'status', items: [] }] },
        },
        {
          variables: {
            input: { ...input, initial: { ...input.initial, limit: 50 } },
          },
        },
      ];
    };
    const host = { inspectQuery } as unknown as CacheHost;

    const result = await inspect(
      host,
      selectAll(GroupSoupMembershipDocument).field('user').field('groupSoup')
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.variables).toEqual({ input });
    expect(result[1]).not.toHaveProperty('value');
  });

  it('infers generated response and variable types', () => {
    const typeAssertions = async (host: CacheHost) => {
      const root = selectAll(GroupSoupMembershipDocument);
      // @ts-expect-error `missing` is not selected by the generated query.
      root.field('missing');

      const selected = root.field('user').field('groupSoup');
      // @ts-expect-error Lists cannot be traversed by v1 inspection paths.
      selected.field('bins').field('length');

      const results = await inspect(host, selected);
      expectTypeOf(
        results[0]!.variables
      ).toEqualTypeOf<GroupSoupMembershipQueryVariables>();
      expectTypeOf(results[0]!.value).toEqualTypeOf<
        GroupSoupMembershipQuery['user']['groupSoup'] | undefined
      >();
      // @ts-expect-error Variables are inferred, not an arbitrary record.
      results[0]!.variables.missing;
      // @ts-expect-error The selected value is groupSoup, not the query root.
      results[0]!.value?.user;
    };

    expect(typeAssertions).toBeTypeOf('function');
  });

  it('returns no selections through the no-op host', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await inspect(
        createNoopCacheHost('test'),
        selectAll(GroupSoupMembershipDocument).field('user').field('groupSoup')
      );
      expect(result).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects malformed host results', async () => {
    const host = {
      inspectQuery: async () => [{ variables: null }],
    } as unknown as CacheHost;
    await expect(
      inspect(
        host,
        selectAll(GroupSoupMembershipDocument).field('user').field('groupSoup')
      )
    ).rejects.toThrow('invalid cache query inspection instance');
  });
});
