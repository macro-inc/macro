import { LoroDoc, LoroMap, LoroText, UndoManager } from 'loro-crdt';
import { describe, expect, it, vi } from 'vitest';
import { Mirror } from '../../src/core/mirror';
import { schema } from '../../src/schema';

const documentSchema = schema({
  nodes: schema.LoroList(schema.LoroMap({ text: schema.LoroText() })),
});
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('batched document notifications', () => {
  it('rebuilds once for bulk local changes, undo, redo and remote imports', async () => {
    const doc = new LoroDoc();
    const list = doc.getList('nodes');
    const texts = Array.from({ length: 100 }, (_, i) => {
      const text = list
        .insertContainer(i, new LoroMap())
        .setContainer('text', new LoroText());
      text.insert(0, `paragraph ${i}`);
      return text;
    });
    doc.commit();
    const mirror = new Mirror({ doc, schema: documentSchema });
    const undo = new UndoManager(doc, { mergeInterval: 0 });
    const notify = vi.fn();
    mirror.subscribe(notify);
    const serialize = vi.spyOn(doc, 'toJSON');
    const check = async () => {
      await flush();
      expect(notify).toHaveBeenCalledTimes(1);
      expect(serialize).toHaveBeenCalledTimes(1);
      expect(mirror.getState()).toEqual(doc.toJSON());
      notify.mockClear();
      serialize.mockClear();
    };
    try {
      for (const text of texts) text.insert(0, 'edit ');
      doc.commit();
      await check();
      undo.undo();
      await check();
      undo.redo();
      await check();
      const remote = doc.fork();
      const version = remote.version();
      for (let i = 0; i < 100; i++) {
        const node = remote.getList('nodes').get(i) as LoroMap;
        (node.get('text') as LoroText).insert(0, 'remote ');
      }
      remote.commit();
      doc.import(remote.export({ mode: 'update', from: version }));
      await check();
      remote.free();
    } finally {
      serialize.mockRestore();
      mirror.dispose();
      undo.free();
      doc.free();
    }
  });
});
