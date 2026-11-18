import { queryClient } from '@queries/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { registerActiveGraphqlSoupQuery } from './graphql/active-queries';
import { soupKeys } from './keys';
import { refreshPropertyQueries } from './property-queries';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

describe('refreshPropertyQueries', () => {
  it('invalidates REST lists but refreshes only unmaintained GraphQL lists after a confirmed option write', async () => {
    onTestFinished(() => queryClient.clear());
    const key = soupKeys.astItems({
      params: {
        sort_method: 'property',
        sort_property_definition_id: 'tag-definition',
      },
      body: {},
    }).queryKey;
    queryClient.setQueryData(key, []);

    const maintained = vi.fn(async () => {});
    const unmaintained = vi.fn(async () => {});
    const unrelated = vi.fn(async () => {});
    onTestFinished(
      registerActiveGraphqlSoupQuery({
        isEnabled: () => true,
        refresh: maintained,
        cacheMaintained: () => true,
        body: () => ({
          sortMethod: 'PROPERTY',
          sortPropertyDefinitionId: 'tag-definition',
        }),
      })
    );
    onTestFinished(
      registerActiveGraphqlSoupQuery({
        isEnabled: () => true,
        refresh: unmaintained,
        cacheMaintained: () => false,
        body: () => ({
          sortMethod: 'PROPERTY',
          sortPropertyDefinitionId: 'tag-definition',
        }),
      })
    );
    onTestFinished(
      registerActiveGraphqlSoupQuery({
        isEnabled: () => true,
        refresh: unrelated,
        body: () => ({
          sortMethod: 'PROPERTY',
          sortPropertyDefinitionId: 'other-definition',
        }),
      })
    );

    await refreshPropertyQueries('tag-definition', { unmaintainedOnly: true });

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(maintained).not.toHaveBeenCalled();
    expect(unmaintained).toHaveBeenCalledOnce();
    expect(unrelated).not.toHaveBeenCalled();

    await refreshPropertyQueries('tag-definition');

    expect(maintained).toHaveBeenCalledOnce();
    expect(unmaintained).toHaveBeenCalledTimes(2);
    expect(unrelated).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'refreshes option-filtered readers with unmaintainedOnly=%s without refreshing unrelated lists',
    async (unmaintainedOnly) => {
      onTestFinished(() => queryClient.clear());
      const filtered = {
        propf: { l: { pd: 'tag-definition', v: { so: 'tag-option' } } },
      };
      const unrelated = {
        propf: { l: { pd: 'other-definition', v: { so: 'tag-definition' } } },
      };
      const ordinary = { df: { l: { dst: 'task' } } };
      const bodies = [filtered, unrelated, ordinary];
      const keys = bodies.map(
        (body) =>
          soupKeys.astItems({ params: { sort_method: 'updated_at' }, body })
            .queryKey
      );
      const readers = bodies.map((body) => {
        const refresh = vi.fn(async () => {});
        onTestFinished(
          registerActiveGraphqlSoupQuery({
            isEnabled: () => true,
            refresh,
            cacheMaintained: () => false,
            body: () => body,
          })
        );
        return refresh;
      });
      const maintained = vi.fn(async () => {});
      onTestFinished(
        registerActiveGraphqlSoupQuery({
          isEnabled: () => true,
          refresh: maintained,
          cacheMaintained: () => true,
          body: () => filtered,
        })
      );
      for (const key of keys) queryClient.setQueryData(key, []);

      await refreshPropertyQueries('tag-definition', {
        includeOptionFilters: true,
        unmaintainedOnly,
      });

      expect(
        keys.map((key) => queryClient.getQueryState(key)?.isInvalidated)
      ).toEqual([true, false, false]);
      expect(readers[0]).toHaveBeenCalledOnce();
      expect(readers[1]).not.toHaveBeenCalled();
      expect(readers[2]).not.toHaveBeenCalled();
      expect(maintained).toHaveBeenCalledTimes(unmaintainedOnly ? 0 : 1);
    }
  );
});
