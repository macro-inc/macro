import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { gql } from '@urql/core';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  getActiveGraphqlSoupRevalidations,
  refreshActiveGraphqlSoupQueries,
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from './active-queries';

function register(query: Parameters<typeof registerActiveGraphqlSoupQuery>[0]) {
  const unregister = registerActiveGraphqlSoupQuery(query);
  onTestFinished(unregister);
  return unregister;
}

describe('active GraphQL Soup queries', () => {
  it('snapshots and deduplicates live descriptors, excluding disabled and unmounted readers', () => {
    const document = gql`query Soup($input: SoupInput!) { soup(input: $input) { nextCursor } }`;
    const initial = { document, variables: { input: { initial: {} } } };
    const continuation = { document, variables: { input: { cursor: 'next' } } };
    let enabled = true;
    let pages: QueryRevalidation[] = [initial];
    const unregister = registerGraphqlSoupRevalidations(() =>
      enabled ? pages : []
    );
    const unregisterDuplicate = registerGraphqlSoupRevalidations(() => [
      initial,
    ]);
    onTestFinished(unregister);
    onTestFinished(unregisterDuplicate);

    expect(getActiveGraphqlSoupRevalidations()).toEqual([initial]);
    pages = [initial, continuation];
    expect(getActiveGraphqlSoupRevalidations()).toEqual([
      initial,
      continuation,
    ]);
    enabled = false;
    expect(getActiveGraphqlSoupRevalidations()).toEqual([initial]);
    unregisterDuplicate();
    expect(getActiveGraphqlSoupRevalidations()).toEqual([]);
    enabled = true;
    unregister();
    expect(getActiveGraphqlSoupRevalidations()).toEqual([]);
  });

  it('strict revalidation fails until every enabled reader succeeds', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    const failure = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const success = vi.fn(async () => undefined);
    register({ isEnabled: () => true, refresh: failure });
    register({ isEnabled: () => true, refresh: success });
    await expect(
      refreshActiveGraphqlSoupQueries({ throwOnError: true })
    ).rejects.toThrow('every active query');
    expect(success).toHaveBeenCalledOnce();
    await expect(
      refreshActiveGraphqlSoupQueries({ throwOnError: true })
    ).resolves.toBeUndefined();
    expect(success).toHaveBeenCalledTimes(2);
  });

  it('strict revalidation ignores disabled readers', async () => {
    const disabled = vi.fn(async () => {
      throw new Error('must not run');
    });
    register({ isEnabled: () => false, refresh: disabled });
    await expect(
      refreshActiveGraphqlSoupQueries({ throwOnError: true })
    ).resolves.toBeUndefined();
    expect(disabled).not.toHaveBeenCalled();
  });

  it('does not claim success for a reader registered during a refresh', async () => {
    let finish!: () => void;
    const firstPass = new Promise<void>((resolve) => {
      finish = resolve;
    });
    register({ isEnabled: () => true, refresh: () => firstPass });
    const refreshed = expect(
      refreshActiveGraphqlSoupQueries({ throwOnError: true })
    ).rejects.toThrow('every active query');
    const newReader = vi.fn(async () => undefined);
    register({ isEnabled: () => true, refresh: newReader });
    finish();
    await refreshed;
    expect(newReader).not.toHaveBeenCalled();
    await expect(
      refreshActiveGraphqlSoupQueries({ throwOnError: true })
    ).resolves.toBeUndefined();
    expect(newReader).toHaveBeenCalledOnce();
  });

  it('a failing reader which unmounts no longer blocks strict completion', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    const unregister = register({
      isEnabled: () => true,
      refresh: () => pending,
    });
    const result = refreshActiveGraphqlSoupQueries({ throwOnError: true });
    unregister();
    fail(new Error('unmounted'));
    await expect(result).resolves.toBeUndefined();
  });

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
