import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { onlineManager } from '@tanstack/solid-query';
import { gql } from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { fromValue } from 'wonka';
import {
  cacheSessionChanged,
  queryChannelNetwork,
  watchReconnect,
} from '../channel-network';

const session = vi.hoisted(() => ({ generation: 'generation-1' }));
const answer = vi.hoisted(() => ({
  persistence: undefined as Promise<string | undefined> | undefined,
}));

vi.mock('@graphql-cache/session-generation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@graphql-cache/session-generation')>();
  return {
    ...actual,
    cacheSessionGeneration: Object.assign(
      Object.create(actual.cacheSessionGeneration),
      { capture: () => session.generation }
    ),
  };
});

vi.mock('@graphql-cache/exchange/normalized-cache-exchange', () => ({
  normalizedCacheResultMetadata: () => ({
    source: 'live-network',
    persistence: answer.persistence,
  }),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({
    query: () =>
      fromValue({ data: { ok: true }, stale: false, hasNext: false }),
  }),
}));

const QUERY = gql`
  query Probe {
    ok
  }
`;

describe('queryChannelNetwork', () => {
  it('says the session changed when the cache refused a read sent under an earlier one', async () => {
    session.generation = 'generation-1';
    let refuse!: () => void;
    answer.persistence = new Promise((resolve) => {
      refuse = () => resolve(undefined);
    });
    const { cached } = await queryChannelNetwork(QUERY, {});

    // Startup's first owner proof replaces the session the read was sent under.
    session.generation = 'generation-2';
    refuse();

    let error: unknown;
    try {
      await cached;
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(StaleCacheAuthorityError);
    expect(cacheSessionChanged(error)).toBe(true);
  });

  it('fails a read the cache refused under the same session', async () => {
    session.generation = 'generation-1';
    answer.persistence = Promise.resolve(undefined);
    const { cached } = await queryChannelNetwork(QUERY, {});

    await expect(cached).rejects.toThrow('channel query could not be cached');
  });
});

describe('watchReconnect', () => {
  const offline = async (run: () => void | Promise<void>) => {
    onlineManager.setOnline(false);
    try {
      await run();
    } finally {
      onlineManager.setOnline(true);
    }
  };

  it('loads again once the connection is back after a load failed with none', () =>
    offline(() => {
      const reload = vi.fn();
      const watch = watchReconnect();
      watch.failed(reload);
      expect(reload).not.toHaveBeenCalled();

      onlineManager.setOnline(true);
      expect(reload).toHaveBeenCalledTimes(1);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      expect(reload).toHaveBeenCalledTimes(1);
    }));

  it('loads again at once when the connection came back before the load failed', () =>
    offline(() => {
      const reload = vi.fn();
      // The request was sent with no connection, which came back meanwhile.
      const watch = watchReconnect();
      onlineManager.setOnline(true);

      watch.failed(reload);
      expect(reload).toHaveBeenCalledTimes(1);
    }));

  it('waits for the connection to come back after a load failed with one', () => {
    const reload = vi.fn();
    const watch = watchReconnect();
    watch.failed(reload);
    expect(reload).not.toHaveBeenCalled();
    watch.stop();
  });

  it('loads nothing once stopped', () =>
    offline(() => {
      const reload = vi.fn();
      const watch = watchReconnect();
      watch.failed(reload);
      watch.stop();

      onlineManager.setOnline(true);
      expect(reload).not.toHaveBeenCalled();
    }));
});
