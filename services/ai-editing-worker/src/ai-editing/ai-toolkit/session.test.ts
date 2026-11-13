import { describe, expect, it } from 'vitest';
import { serializeWithXml } from '../utils';
import { setup, topLevelIds } from './_test-helpers';
import {
  createEditingSession,
  isMarkdownLoroState,
  loadSnapshot,
  toSnapshot,
} from './session';

describe('session / IO', () => {
  it('toSnapshot/loadSnapshot round-trips content and ids', () => {
    const { session, ids } = setup('# Title\n\nbody text');
    const snap = toSnapshot(session);

    const session2 = createEditingSession();
    loadSnapshot(session2, snap);
    expect(topLevelIds(session2)).toEqual(ids);
    expect(serializeWithXml(session2)).toBe(serializeWithXml(session));
  });
});

describe('isMarkdownLoroState', () => {
  it('accepts an editor snapshot and rejects shapes the Mirror refuses', () => {
    const { session } = setup('Alpha\n\n- one');
    expect(isMarkdownLoroState(toSnapshot(session))).toBe(true);
    expect(isMarkdownLoroState({ root: { children: 'not a list' } })).toBe(
      false
    );
    expect(isMarkdownLoroState({ root: { text: 7 } })).toBe(false);
  });
});
