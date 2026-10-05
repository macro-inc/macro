import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  changedKeys,
  documentBase,
  documentFormat,
  entriesApplyTo,
  readEntries,
  recordStoredFile,
  restartOnFile,
  seedDocument,
  sessionsInUse,
  storedLayers,
  tilesWithPrefixes,
  writeEntryChanges,
} from './collab-entries';

function seeded() {
  const doc = new LoroDoc();
  seedDocument(doc);
  return doc;
}

describe('shared document entries', () => {
  it('seeds the format', () => {
    const doc = seeded();
    expect(documentFormat(doc)).toBe(1);
    expect(documentFormat(new LoroDoc())).toBeUndefined();
  });

  it('records stored files and their layer grids', () => {
    const doc = seeded();
    expect(entriesApplyTo(doc, 'a')).toBe(true);
    expect(recordStoredFile(doc, 'a')).toBe(true);
    expect(documentBase(doc)).toBe('a');
    // Stored from the shared document: it applies.
    expect(recordStoredFile(doc, 'b', '{"5":{}}')).toBe(true);
    expect(entriesApplyTo(doc, 'b')).toBe(true);
    expect(storedLayers(doc, 'b')).toBe('{"5":{}}');
    expect(storedLayers(doc, 'a')).toBeNull();
    // Nothing new: nothing written.
    expect(recordStoredFile(doc, 'b', '{"5":{}}')).toBe(false);
    // A file stored outside the session does not apply.
    expect(entriesApplyTo(doc, 'c')).toBe(false);
  });

  it('starts over on a replaced file', () => {
    const doc = seeded();
    recordStoredFile(doc, 'a', '{}');
    writeEntryChanges(doc, [
      { container: 'psdLayers', key: '65537', value: '{}' },
      { container: 'psdTiles', key: '65537:p:3:0,0', value: 'x' },
    ]);
    restartOnFile(doc, 'z');
    expect(readEntries(doc)).toEqual([]);
    expect(documentBase(doc)).toBe('z');
    expect(entriesApplyTo(doc, 'z')).toBe(true);
    expect(storedLayers(doc, 'a')).toBeNull();
    expect(documentFormat(doc)).toBe(1);
  });

  it('reads the tiles a layer state wants', () => {
    const doc = seeded();
    writeEntryChanges(doc, [
      { container: 'psdTiles', key: '7:p:2:0,0', value: 'a' },
      { container: 'psdTiles', key: '7:p:2:1,0', value: 'b' },
      { container: 'psdTiles', key: '7:p:1:0,0', value: 'old' },
      { container: 'psdTiles', key: '7:m:2:0,0', value: 'mask' },
      { container: 'psdTiles', key: '17:p:2:0,0', value: 'other' },
    ]);
    const wanted = tilesWithPrefixes(doc, ['7:p:2:'])
      .map((c) => c.key)
      .sort();
    expect(wanted).toEqual(['7:p:2:0,0', '7:p:2:1,0']);
    expect(tilesWithPrefixes(doc, [])).toEqual([]);
  });

  it('writes, deletes, and reports changed keys', () => {
    const doc = seeded();
    const seen: string[] = [];
    doc.subscribe((batch) => {
      for (const k of changedKeys(doc, batch)) seen.push(`${k.container}/${k.key}`);
    });
    writeEntryChanges(doc, [
      { container: 'psdLayers', key: '1', value: 'x' },
      { container: 'elsewhere', key: '2', value: 'y' },
    ]);
    writeEntryChanges(doc, [{ container: 'psdLayers', key: '1', value: null }]);
    expect(seen).toEqual(['psdLayers/1', 'psdLayers/1']);
    expect(readEntries(doc)).toEqual([]);
  });

  it('lists the id sessions shared layers use', () => {
    const doc = seeded();
    writeEntryChanges(doc, [
      { container: 'psdLayers', key: String((3 << 16) | 1), value: '{}' },
      { container: 'psdLayers', key: '12', value: '{}' },
    ]);
    expect([...sessionsInUse(doc)].sort()).toEqual([0, 3]);
  });
});
