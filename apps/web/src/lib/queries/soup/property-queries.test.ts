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
});
