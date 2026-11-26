/**
 * The cache benchmark (`crates/client/cache-bench`) replays the Mail tabs'
 * list reads from a fixture so its Rust and browser halves send the same
 * inputs. This keeps that fixture equal to what the app sends:
 * `buildEmailQuery`, then `makeGraphqlSoupInput`. Regenerate it with
 * `UPDATE_CACHE_BENCH_TABS=1 bun run test -- cache-bench-mail-tabs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMPTY_TAG_FACET_CONTEXT } from '@app/features/soup';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { describe, expect, it, vi } from 'vitest';
import { buildEmailQuery } from './email-query';

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/notification')),
  ...(await import('@entity/utils/task-properties')),
  ...(await import('@entity/utils/company-properties')),
}));
vi.mock('@notifications', async () => await import('@notifications/types'));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const FIXTURE = resolve(
  __dirname,
  '../../../lib/graphql-cache/worker/browser-test/bench-mail-tabs.json'
);

/** The tabs a Mail user opens first, every linked inbox, no facets. */
const TABS = ['important', 'noise', 'all'] as const;

describe('cache benchmark Mail tab inputs', () => {
  it('match the inputs the app sends', () => {
    const inputs = Object.fromEntries(
      TABS.map((tab) => [
        tab,
        makeGraphqlSoupInput(
          buildEmailQuery({
            tab,
            inboxIds: undefined,
            facets: {},
            facetContext: EMPTY_TAG_FACET_CONTEXT,
          })
        ).initial,
      ])
    );
    const text = `${JSON.stringify(inputs, null, 2)}\n`;
    if (process.env.UPDATE_CACHE_BENCH_TABS) writeFileSync(FIXTURE, text);
    expect(readFileSync(FIXTURE, 'utf8')).toBe(text);
  });
});
