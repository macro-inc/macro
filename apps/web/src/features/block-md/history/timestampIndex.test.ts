import { AutomergeDoc } from '@macro-inc/automerge';
import { markdownToAutomergeSnapshot } from '@macro-inc/lexical-core/markdown-automerge-snapshot';
import { expect, test } from 'vitest';
import { buildTimestampIndex } from './timestampIndex';

test('native historical views materialize nested editor lists', async () => {
  const doc = new AutomergeDoc();
  try {
    const snapshot = await markdownToAutomergeSnapshot('Historical **text**');
    expect(snapshot).toBeDefined();
    doc.import(snapshot!);
    const index = buildTimestampIndex(doc);
    const at = Date.now();
    const state = index.checkoutAt(at);
    expect(state).toEqual(doc.toJSON());
    expect(Array.isArray(state?.root.children)).toBe(true);
    expect(index.versionIdAt(at)?.sort()).toEqual(doc.frontiers().sort());
  } finally {
    doc.free();
  }
});
