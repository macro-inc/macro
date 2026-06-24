import { describe, expect, it } from 'vitest';
import { createEditingSession, loadSnapshot, toSnapshot } from './session';
import {
  serializedWithoutLinePrefix,
  setup,
  topLevelIds,
} from './_test-helpers';

describe('session / IO', () => {
  it('loadMarkdown + serializeWithIds appends one {id} per top-level block', () => {
    const { s } = setup('# Title\n\nbody text');
    const out = serializedWithoutLinePrefix(s);
    const lines = out.split('\n\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^# Title \{[^}]+\}$/);
    expect(lines[1]).toMatch(/^body text \{[^}]+\}$/);
  });

  it('a list is one block but each item carries its own id', () => {
    const { s } = setup('- a\n- b\n- c');
    const out = serializedWithoutLinePrefix(s);
    // one block => no blank-line separator splitting it into multiple
    expect(out.split('\n\n')).toHaveLength(1);
    // every item line ends with its own id (3 items => 3 ids)
    expect(out.match(/\{[^}]+\}/g)).toHaveLength(3);
    for (const line of out.split('\n')) expect(line).toMatch(/\{[^}]+\}$/);
  });

  it('toSnapshot/loadSnapshot round-trips content and ids', () => {
    const { s, ids } = setup('# Title\n\nbody text');
    const snap = toSnapshot(s);

    const s2 = createEditingSession();
    loadSnapshot(s2, snap);
    expect(topLevelIds(s2)).toEqual(ids);
    expect(serializedWithoutLinePrefix(s2)).toBe(
      serializedWithoutLinePrefix(s)
    );
  });
});
