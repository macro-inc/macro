import { describe, expect, it } from 'vitest';
import { serializeWithXml } from '../utils';
import { setup, topLevelIds } from './_test-helpers';
import { createEditingSession, loadSnapshot, toSnapshot } from './session';

describe('session / IO', () => {
  it('loadMarkdown + serializeWithXml emits h1 and p tags for heading and body', () => {
    const { session } = setup('# Title\n\nbody text');
    const out = serializeWithXml(session);
    expect(out).toContain('<h1');
    expect(out).toContain('Title');
    expect(out).toContain('<p');
    expect(out).toContain('body text');
  });

  it('a list is one block and XML contains ul and li tags', () => {
    const { session } = setup('- a\n- b\n- c');
    const out = serializeWithXml(session);
    expect(out).toContain('<ul');
    expect(out).toContain('<li');
  });

  it('toSnapshot/loadSnapshot round-trips content and ids', () => {
    const { session, ids } = setup('# Title\n\nbody text');
    const snap = toSnapshot(session);

    const session2 = createEditingSession();
    loadSnapshot(session2, snap);
    expect(topLevelIds(session2)).toEqual(ids);
    expect(serializeWithXml(session2)).toBe(serializeWithXml(session));
  });
});
