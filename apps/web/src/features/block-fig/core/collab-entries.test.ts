import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  baseBlobs,
  changedKeys,
  designFormat,
  type EntryKey,
  readEntries,
  readValues,
  seedDesign,
  writeEntryChanges,
} from './collab-entries';

const sync = (from: LoroDoc, to: LoroDoc) =>
  to.import(from.export({ mode: 'update', from: to.oplogVersion() }));

describe('collab entries', () => {
  it('seeds a design and reads its format and base', () => {
    const doc = new LoroDoc();
    expect(designFormat(doc)).toBeUndefined();
    seedDesign(doc);
    expect(designFormat(doc)).toBe(1);
    expect(baseBlobs(doc)).toBeNull();
    writeEntryChanges(doc, [
      { container: 'figMeta', key: 'baseBlobs', value: '42' },
    ]);
    expect(baseBlobs(doc)).toBe(42);
  });

  it('writes, reads, and reports entries between peers', () => {
    const alice = new LoroDoc();
    seedDesign(alice);
    writeEntryChanges(alice, [
      { container: 'figNodes', key: '1:2', value: 'AQID' },
      { container: 'figBlobs', key: 'abc', value: 'BAUG' },
      { container: 'notADesign', key: 'x', value: 'ignored' },
    ]);
    expect(readEntries(alice)).toEqual(
      expect.arrayContaining([
        { container: 'figNodes', key: '1:2', value: 'AQID' },
        { container: 'figBlobs', key: 'abc', value: 'BAUG' },
      ])
    );
    expect(readEntries(alice).some((e) => e.container === 'notADesign')).toBe(
      false
    );

    const bob = new LoroDoc();
    sync(alice, bob);
    const seen: EntryKey[] = [];
    bob.subscribe((batch) => seen.push(...changedKeys(bob, batch)));
    writeEntryChanges(alice, [
      { container: 'figNodes', key: '1:2', value: 'BwgJ' },
      { container: 'figNodes', key: '7:1', value: 'CgsM' },
    ]);
    sync(alice, bob);
    expect(seen).toEqual(
      expect.arrayContaining([
        { container: 'figNodes', key: '1:2' },
        { container: 'figNodes', key: '7:1' },
      ])
    );
    // Values are read as they are when applied.
    expect(readValues(bob, seen)).toEqual(
      expect.arrayContaining([
        { container: 'figNodes', key: '1:2', value: 'BwgJ' },
      ])
    );
    expect(readEntries(bob)).toEqual(readEntries(alice));
  });

  it('resolves concurrent writes to one node the same way everywhere', () => {
    const alice = new LoroDoc();
    const bob = new LoroDoc();
    alice.setPeerId(1);
    bob.setPeerId(2);
    writeEntryChanges(alice, [
      { container: 'figNodes', key: '1:2', value: 'alice' },
    ]);
    writeEntryChanges(bob, [
      { container: 'figNodes', key: '1:2', value: 'bob' },
    ]);
    sync(alice, bob);
    sync(bob, alice);
    const value = (doc: LoroDoc) => doc.getMap('figNodes').get('1:2');
    expect(value(alice)).toBe(value(bob));
  });
});
