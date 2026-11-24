import { describe, expect, it } from 'vitest';
import {
  renderSyncLaneQueries,
  staleSyncLaneQueries,
} from './generate-sync-lane-queries';

describe('sync lane queries', () => {
  it('match the app documents they are generated from', () => {
    // Run `bun run gen-sync-lane-queries` in apps/web when this fails.
    expect(staleSyncLaneQueries()).toEqual([]);
  });

  it('carry no client-only directives', () => {
    for (const { path, contents } of renderSyncLaneQueries()) {
      expect(contents, path).not.toMatch(/@cacheOnly/);
    }
  });
});
