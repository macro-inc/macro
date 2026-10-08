import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  baseBlobs,
  changedKeys,
  designBase,
  designFormat,
  type EntryKey,
  entriesApplyTo,
  fileFingerprint,
  readEntries,
  readValues,
  recordStoredFile,
  restartOnFile,
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

describe('stored files', () => {
  it('applies entries to the file they began on and files stored from it', () => {
    const doc = new LoroDoc();
    seedDesign(doc);
    // Shared before files were recorded: the first file opened begins it.
    expect(entriesApplyTo(doc, 'first')).toBe(true);
    expect(recordStoredFile(doc, 'first')).toBe(true);
    expect(designBase(doc)).toBe('first');
    expect(recordStoredFile(doc, 'first')).toBe(false);
    // Someone stores the merged file; it is listed before it is stored.
    recordStoredFile(doc, 'saved');
    expect(entriesApplyTo(doc, 'first')).toBe(true);
    expect(entriesApplyTo(doc, 'saved')).toBe(true);
    // A file stored outside the design is not.
    expect(entriesApplyTo(doc, 'uploaded')).toBe(false);
  });

  it('starts over on a replaced file, dropping the entries', () => {
    const alice = new LoroDoc();
    seedDesign(alice);
    recordStoredFile(alice, 'first');
    writeEntryChanges(alice, [
      { container: 'figNodes', key: '1:2', value: 'AQID' },
      { container: 'figBlobs', key: 'abc', value: 'BAUG' },
      { container: 'figMeta', key: 'baseBlobs', value: '3' },
    ]);
    const bob = new LoroDoc();
    sync(alice, bob);
    restartOnFile(bob, 'uploaded');
    sync(bob, alice);
    for (const doc of [alice, bob]) {
      expect(readEntries(doc)).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({ container: 'figNodes' }),
        ])
      );
      expect(designFormat(doc)).toBe(1);
      expect(designBase(doc)).toBe('uploaded');
      expect(baseBlobs(doc)).toBeNull();
      expect(entriesApplyTo(doc, 'uploaded')).toBe(true);
      expect(entriesApplyTo(doc, 'first')).toBe(false);
    }
  });

  it('fingerprints file bytes', async () => {
    const a = await fileFingerprint(new Uint8Array([1, 2, 3]));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await fileFingerprint(new Uint8Array([1, 2, 3]))).toBe(a);
    expect(await fileFingerprint(new Uint8Array([1, 2, 4]))).not.toBe(a);
  });
});
