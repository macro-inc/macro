import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  changedKeys,
  documentBase,
  documentFormat,
  type EntryKey,
  entriesApplyTo,
  hasDocumentState,
  readEntries,
  readValues,
  recordStoredFile,
  restartOnFile,
  seedDocument,
  writeEntryChanges,
} from './collab-entries';

const sync = (from: LoroDoc, to: LoroDoc) =>
  to.import(from.export({ mode: 'update', from: to.oplogVersion() }));

describe('collab entries', () => {
  it('seeds a document and reads its format', () => {
    const doc = new LoroDoc();
    expect(documentFormat(doc)).toBeUndefined();
    seedDocument(doc);
    expect(documentFormat(doc)).toBe(1);
    expect(hasDocumentState(doc)).toBe(false);
    writeEntryChanges(doc, [{ container: 'aiDoc', key: 'state', value: '{}' }]);
    expect(hasDocumentState(doc)).toBe(true);
  });

  it('writes, reads, and reports entries between people', () => {
    const alice = new LoroDoc();
    seedDocument(alice);
    writeEntryChanges(alice, [
      { container: 'aiNodes', key: '12', value: '{"id":12}' },
      { container: 'aiImages', key: 'abc', value: '{"data":""}' },
      { container: 'notADocument', key: 'x', value: 'ignored' },
    ]);
    expect(readEntries(alice)).toEqual(
      expect.arrayContaining([
        { container: 'aiNodes', key: '12', value: '{"id":12}' },
        { container: 'aiImages', key: 'abc', value: '{"data":""}' },
      ])
    );
    // The stored-file record is the app's, not the engine's.
    expect(readEntries(alice).some((e) => e.container === 'aiMeta')).toBe(
      false
    );

    const bob = new LoroDoc();
    sync(alice, bob);
    const seen: EntryKey[] = [];
    bob.subscribe((batch) => seen.push(...changedKeys(bob, batch)));
    writeEntryChanges(alice, [
      { container: 'aiNodes', key: '12', value: '{"id":12,"hidden":true}' },
      { container: 'aiNodes', key: '13', value: null },
    ]);
    sync(alice, bob);
    expect(seen).toEqual(
      expect.arrayContaining([{ container: 'aiNodes', key: '12' }])
    );
    expect(readValues(bob, [{ container: 'aiNodes', key: '12' }])).toEqual([
      { container: 'aiNodes', key: '12', value: '{"id":12,"hidden":true}' },
    ]);
    expect(readEntries(bob)).toEqual(readEntries(alice));
  });
});

describe('stored files', () => {
  it('applies entries to the file they began on and files stored from it', () => {
    const doc = new LoroDoc();
    seedDocument(doc);
    expect(entriesApplyTo(doc, 'first')).toBe(true);
    expect(recordStoredFile(doc, 'first')).toBe(true);
    expect(documentBase(doc)).toBe('first');
    expect(recordStoredFile(doc, 'first')).toBe(false);
    recordStoredFile(doc, 'saved');
    expect(entriesApplyTo(doc, 'saved')).toBe(true);
    expect(entriesApplyTo(doc, 'uploaded')).toBe(false);
  });

  it('starts over on a replaced file, dropping the entries', () => {
    const alice = new LoroDoc();
    seedDocument(alice);
    recordStoredFile(alice, 'first');
    writeEntryChanges(alice, [
      { container: 'aiNodes', key: '12', value: '{}' },
      { container: 'aiDoc', key: 'state', value: '{}' },
    ]);
    const bob = new LoroDoc();
    sync(alice, bob);
    restartOnFile(bob, 'uploaded');
    sync(bob, alice);
    for (const doc of [alice, bob]) {
      expect(readEntries(doc)).toEqual([]);
      expect(documentFormat(doc)).toBe(1);
      expect(documentBase(doc)).toBe('uploaded');
      expect(entriesApplyTo(doc, 'first')).toBe(false);
    }
  });
});
