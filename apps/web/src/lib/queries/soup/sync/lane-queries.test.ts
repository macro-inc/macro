import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncLaneQueries } from './lane-queries';

/**
 * The server's catalog tests plan and validate every lane with exactly what
 * this build sends, read from this fixture.
 */
const FIXTURE = resolve(
  __dirname,
  '../../../../../../../crates/soup_sync_stream/src/catalog/test/client_queries.json'
);

function fixtureContents(): string {
  const queries = syncLaneQueries();
  const sorted = Object.fromEntries(
    Object.keys(queries)
      .sort()
      .map((operation) => [operation, queries[operation]])
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

describe('sync lane queries', () => {
  it('match the server catalog tests fixture', () => {
    const contents = fixtureContents();
    if (process.env.UPDATE_SYNC_LANE_QUERIES === '1') {
      writeFileSync(FIXTURE, contents);
    }
    // Run with UPDATE_SYNC_LANE_QUERIES=1 to rewrite the fixture.
    expect(readFileSync(FIXTURE, 'utf8')).toBe(contents);
  });

  it('carry no client-only directives', () => {
    for (const [operation, query] of Object.entries(syncLaneQueries())) {
      expect(query, operation).not.toMatch(/@cacheOnly/);
    }
  });
});
