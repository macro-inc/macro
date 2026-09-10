import { describe, expect, it, vi } from 'vitest';
import {
  refreshActiveGraphqlSoupQueries,
  registerActiveGraphqlSoupQuery,
} from './active-queries';

describe('active GraphQL Soup queries', () => {
  it('refreshes only enabled registered queries', async () => {
    const enabledRefresh = vi.fn(async () => undefined);
    const disabledRefresh = vi.fn(async () => undefined);
    const unregisterEnabled = registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: enabledRefresh,
    });
    const unregisterDisabled = registerActiveGraphqlSoupQuery({
      isEnabled: () => false,
      refresh: disabledRefresh,
    });

    await refreshActiveGraphqlSoupQueries();

    expect(enabledRefresh).toHaveBeenCalledOnce();
    expect(disabledRefresh).not.toHaveBeenCalled();

    unregisterEnabled();
    unregisterDisabled();
  });

  it('stops refreshing a query after it unregisters', async () => {
    const refresh = vi.fn(async () => undefined);
    const unregister = registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh,
    });
    unregister();

    await refreshActiveGraphqlSoupQueries();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('isolates refresh failures so other active queries still refresh', async () => {
    const error = new Error('refresh failed');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const unregisterFailure = registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: vi.fn(async () => {
        throw error;
      }),
    });
    const successfulRefresh = vi.fn(async () => undefined);
    const unregisterSuccess = registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: successfulRefresh,
    });

    await refreshActiveGraphqlSoupQueries();

    expect(successfulRefresh).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      '[graphql-soup] failed to refresh active query',
      error
    );

    unregisterFailure();
    unregisterSuccess();
    consoleError.mockRestore();
  });
});
