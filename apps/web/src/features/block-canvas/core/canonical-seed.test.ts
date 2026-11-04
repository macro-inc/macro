import { readFileSync } from 'node:fs';
import { LoroDoc } from 'loro-crdt';
import { expect, it } from 'vitest';
import { readSharedCanvas } from './collaboration';

it('the backend creation seed uses the browser Canvas schema and an empty scene', () => {
  const doc = new LoroDoc();
  try {
    doc.import(readFileSync('../../static_assets/canvas-golden.1.bin'));
    const file = readSharedCanvas(doc);
    expect(file.version).toBe(2);
    expect(file.document.items).toEqual({
      [file.document.rootId]: { id: file.document.rootId, type: 'surface' },
    });
  } finally {
    doc.free();
  }
});
