import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  changesFromEvent,
  presentationFormat,
  readEntries,
  writeEntryChanges,
} from './collab-entries';

describe('collab entries', () => {
  it('writes, reads, and reports changes between peers', () => {
    const alice = new LoroDoc();
    writeEntryChanges(alice, [
      { container: 'pptxMeta', key: 'format', value: '1' },
      { container: 'pptxShapes', key: '/ppt/slides/slide1.xml|2', value: 'a' },
      { container: 'notPresentation', key: 'x', value: 'ignored' },
    ]);
    expect(presentationFormat(alice)).toBe(1);
    expect(readEntries(alice).pptxShapes).toEqual({
      '/ppt/slides/slide1.xml|2': 'a',
    });

    const bob = new LoroDoc();
    bob.import(alice.export({ mode: 'snapshot' }));
    const seen: ReturnType<typeof changesFromEvent>[] = [];
    bob.subscribe((batch) => seen.push(changesFromEvent(bob, batch)));
    writeEntryChanges(alice, [
      { container: 'pptxShapes', key: '/ppt/slides/slide1.xml|2', value: null },
      { container: 'pptxShapes', key: '/ppt/slides/slide1.xml|9', value: 'b' },
    ]);
    bob.import(alice.export({ mode: 'update', from: bob.oplogVersion() }));
    expect(seen.flat()).toEqual(
      expect.arrayContaining([
        {
          container: 'pptxShapes',
          key: '/ppt/slides/slide1.xml|2',
          value: null,
        },
        {
          container: 'pptxShapes',
          key: '/ppt/slides/slide1.xml|9',
          value: 'b',
        },
      ])
    );
    expect(readEntries(bob)).toEqual(readEntries(alice));
  });

  it('reports no format before seeding', () => {
    expect(presentationFormat(new LoroDoc())).toBeUndefined();
  });
});
