import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';

describe('collaboration snapshots', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('roundtrips %i branches', (heads) => {
    const doc = new LoroDoc();
    // Three independent histories reproduce Loro 1.13.7 choosing one head as
    // the shallow root and dropping the history required by the other two.
    for (let index = 1; index <= heads; index++) {
      const peer = String(index);
      const branch = new LoroDoc();
      branch.setPeerId(peer);
      branch.getMap('values').set(peer, peer);
      doc.import(branch.export({ mode: 'update' }));
      branch.free();
    }

    const restored = new LoroDoc();
    restored.import(
      doc.export({
        mode: 'shallow-snapshot',
        frontiers: doc.oplogFrontiers(),
      })
    );
    expect(restored.toJSON()).toEqual(doc.toJSON());
    expect(restored.version().toJSON()).toEqual(doc.version().toJSON());
    expect(restored.oplogFrontiers()).toEqual(doc.oplogFrontiers());

    const beforeEdit = doc.version();
    restored.getMap('values').set('after-reconnect', 'preserved');
    doc.import(restored.export({ mode: 'update', from: beforeEdit }));
    expect(doc.toJSON()).toEqual(restored.toJSON());
    const beforeRemoteEdit = restored.version();
    doc.getMap('values').set('remote-edit', 'preserved');
    restored.import(doc.export({ mode: 'update', from: beforeRemoteEdit }));
    expect(restored.toJSON()).toEqual(doc.toJSON());
    expect(restored.version().toJSON()).toEqual(doc.version().toJSON());
    restored.free();
    doc.free();
  });

  it.each([2, 3, 5])('compacts shared history with %i heads', (heads) => {
    const doc = new LoroDoc();
    doc.setPeerId('100');
    const text = doc.getText('content');
    text.insert(0, 'discarded history '.repeat(10_000));
    doc.commit();
    text.delete(0, text.length);
    text.insert(0, 'Saved content');
    doc.commit();
    const common = doc.export({ mode: 'snapshot' });
    const root = doc.oplogFrontiers();
    for (let peer = 1; peer <= heads; peer++) {
      const branch = new LoroDoc();
      branch.import(common);
      branch.setPeerId(String(peer));
      branch.getMap('values').set(String(peer), peer);
      doc.import(
        branch.export({ mode: 'update', from: branch.frontiersToVV(root) })
      );
      branch.free();
    }
    expect(doc.oplogFrontiers()).toHaveLength(heads);

    const full = doc.export({ mode: 'snapshot' });
    const compact = doc.export({
      mode: 'shallow-snapshot',
      frontiers: doc.oplogFrontiers(),
    });
    const restored = new LoroDoc();
    restored.import(compact);
    expect(restored.isShallow()).toBe(true);
    expect(restored.shallowSinceFrontiers()).toEqual(root);
    expect(restored.toJSON()).toEqual(doc.toJSON());
    expect(restored.version().toJSON()).toEqual(doc.version().toJSON());
    expect(compact.length).toBeLessThan(full.length / 2);

    restored.getMap('values').set('after-reconnect', true);
    doc.import(restored.export({ mode: 'update', from: doc.version() }));
    expect(doc.toJSON()).toEqual(restored.toJSON());
    restored.free();
    doc.free();
  });

  it('still compacts a document with one head', () => {
    const doc = new LoroDoc();
    doc.getText('content').insert(0, 'before');
    doc.commit();
    doc.getText('content').insert(6, ' after');
    doc.commit();

    const restored = new LoroDoc();
    restored.import(
      doc.export({
        mode: 'shallow-snapshot',
        frontiers: doc.oplogFrontiers(),
      })
    );
    expect(restored.isShallow()).toBe(true);
    expect(restored.toJSON()).toEqual(doc.toJSON());
    restored.free();
    doc.free();
  });
});
