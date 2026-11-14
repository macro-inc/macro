import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { buildTimestampIndex } from './timestampIndex';

describe('buildTimestampIndex', () => {
  it('does not leave the passed document checked out after previewing a non-lexical snapshot', () => {
    const live = new LoroDoc();
    live.getMap('spreadsheetValues').set('A1', '42');
    live.commit();
    const latest = live.version().toJSON();

    expect(buildTimestampIndex(live).checkoutAt(Date.now())).toBeNull();

    expect(live.version().toJSON()).toEqual(latest);
    expect(live.getMap('spreadsheetValues').get('A1')).toBe('42');
    live.free();
  });

  it('previews concurrent heads together without detaching the source document', () => {
    const doc = new LoroDoc();
    const a = new LoroDoc();
    a.setPeerId('1');
    a.getMap('root').set('type', 'root');
    a.getMap('root').set('fromA', 'A');
    a.commit();
    const b = new LoroDoc();
    b.setPeerId('2');
    b.getMap('root').set('type', 'root');
    b.getMap('root').set('fromB', 'B');
    b.commit();
    doc.import(a.export({ mode: 'update' }));
    doc.import(b.export({ mode: 'update' }));
    const latest = doc.version().toJSON();

    const preview = buildTimestampIndex(doc).checkoutAt(Date.now() + 1_000);
    expect(preview).toMatchObject({
      root: { type: 'root', fromA: 'A', fromB: 'B' },
    });
    expect(doc.version().toJSON()).toEqual(latest);
    expect(doc.getMap('root').toJSON()).toMatchObject({
      type: 'root',
      fromA: 'A',
      fromB: 'B',
    });

    a.free();
    b.free();
    doc.free();
  });
});
