import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { buildTimestampIndex } from './timestampIndex';

describe('buildTimestampIndex', () => {
  it('does not leave the passed document checked out after previewing a non-lexical snapshot', () => {
    const live = new LoroDoc();
    live.setRecordTimestamp(true);
    live.setNextCommitTimestamp(1_700_000_000);
    live.getMap('spreadsheetValues').set('A1', '42');
    live.commit();
    live.setNextCommitTimestamp(1_700_000_100);
    live.getMap('spreadsheetValues').set('A1', '99');
    live.commit();
    const latest = live.version().toJSON();

    expect(buildTimestampIndex(live).checkoutAt(1_700_000_000_000)).toBeNull();

    expect(live.isDetached()).toBe(false);
    expect(live.version().toJSON()).toEqual(latest);
    expect(live.getMap('spreadsheetValues').get('A1')).toBe('99');
    live.free();
  });

  it('previews concurrent heads together without detaching the source document', () => {
    const doc = new LoroDoc();
    const a = new LoroDoc();
    a.setPeerId('1');
    a.setRecordTimestamp(true);
    a.setNextCommitTimestamp(1_700_000_000);
    a.getMap('root').set('type', 'root');
    a.getMap('root').set('fromA', 'A');
    a.commit();
    const b = new LoroDoc();
    b.setPeerId('2');
    b.setRecordTimestamp(true);
    b.setNextCommitTimestamp(1_700_000_000);
    b.getMap('root').set('type', 'root');
    b.getMap('root').set('fromB', 'B');
    b.commit();
    doc.import(a.export({ mode: 'update' }));
    doc.import(b.export({ mode: 'update' }));
    doc.setRecordTimestamp(true);
    doc.setNextCommitTimestamp(1_700_000_100);
    doc.getMap('root').set('later', 'yes');
    doc.commit();
    const latest = doc.version().toJSON();

    const preview = buildTimestampIndex(doc).checkoutAt(1_700_000_000_500);
    expect(preview).toMatchObject({
      root: { type: 'root', fromA: 'A', fromB: 'B' },
    });
    expect(preview).not.toMatchObject({ root: { later: 'yes' } });
    expect(doc.isDetached()).toBe(false);
    expect(doc.version().toJSON()).toEqual(latest);
    expect(doc.getMap('root').toJSON()).toMatchObject({
      type: 'root',
      fromA: 'A',
      fromB: 'B',
      later: 'yes',
    });

    a.free();
    b.free();
    doc.free();
  });
});
