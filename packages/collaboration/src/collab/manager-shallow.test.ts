import { schema } from '@loro-mirror/core';
import { LoroDoc } from 'loro-crdt';
import { afterEach, describe, expect, it } from 'vitest';
import { LoroManager, LoroManagerError } from './manager';
import { loroDocFromSnapshot } from './utils';

const TEST_SCHEMA = schema({ text: schema.LoroText() });
const managers: LoroManager<typeof TEST_SCHEMA>[] = [];
const documents: LoroDoc[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
  for (const document of documents.splice(0)) document.free();
});

function createDocument() {
  const document = new LoroDoc();
  documents.push(document);
  return document;
}

function createManager() {
  const manager = new LoroManager(TEST_SCHEMA, {
    documentId: `shallow-import-${managers.length}`,
  });
  managers.push(manager);
  return manager;
}

function independentHeadSnapshot(heads: number) {
  const source = createDocument();
  for (let peer = 1; peer <= heads; peer++) {
    const document = createDocument();
    document.setPeerId(BigInt(peer));
    document.getText('text').insert(0, String(peer));
    document.commit();
    source.import(document.export({ mode: 'update' }));
  }
  return {
    source,
    snapshot: source.export({
      mode: 'shallow-snapshot',
      frontiers: source.oplogFrontiers(),
    }),
  };
}

describe('shallow snapshot initialization', () => {
  it.each([1, 2, 3, 4, 5])(
    'cold-loads %i independent heads without adding local history',
    async (heads) => {
      const { source, snapshot } = independentHeadSnapshot(heads);
      const manager = createManager();
      const peerId = manager.peerId;

      expect(await manager.ingest({ kind: 'dss', snapshot })).toBe(true);
      expect(manager.initialized).toBe(true);
      expect(manager.state?.state.text).toBe(source.getText('text').toString());
      expect(manager.doc.toJSON()).toEqual(source.toJSON());
      expect(manager.doc.version().toJSON()).toEqual(source.version().toJSON());
      expect(manager.doc.oplogVersion().toJSON()).toEqual(
        source.oplogVersion().toJSON()
      );
      expect(manager.doc.isDetached()).toBe(false);
      expect(manager.peerId).toBe(peerId);
    }
  );

  it('loads cached shallow snapshots through the standalone snapshot helper', () => {
    const { source, snapshot } = independentHeadSnapshot(3);
    const restored = loroDocFromSnapshot(snapshot);
    documents.push(restored);

    expect(restored.toJSON()).toEqual(source.toJSON());
    expect(restored.version().toJSON()).toEqual(source.version().toJSON());
    expect(restored.isDetached()).toBe(false);
  });

  it('resets an initialized manager from an independent-head shallow snapshot', async () => {
    const manager = createManager();
    const initial = createDocument();
    initial.getText('text').insert(0, 'Previous document state');
    await manager.initializeFromSnapshot(initial.export({ mode: 'snapshot' }));
    const { source, snapshot } = independentHeadSnapshot(3);

    expect((await manager.reset(snapshot)).isOk()).toBe(true);
    expect(manager.state?.state.text).toBe(source.getText('text').toString());
    expect(manager.doc.version().toJSON()).toEqual(source.version().toJSON());
  });

  it('converges concurrent local and remote edits after a cold shallow import', async () => {
    const { source, snapshot } = independentHeadSnapshot(3);
    const manager = createManager();
    expect(await manager.ingest({ kind: 'dss', snapshot })).toBe(true);
    const baseline = source.version();
    const originalText = source.getText('text').toString();

    expect(
      (await manager.syncToLoro({ text: `${originalText} local` })).isOk()
    ).toBe(true);
    source.getText('text').insert(source.getText('text').length, ' remote');
    source.commit();
    const local = manager.doc.export({ mode: 'update', from: baseline });
    const remote = source.export({ mode: 'update', from: baseline });

    expect(manager.importUpdate(remote).isOk()).toBe(true);
    source.import(local);
    expect(manager.doc.toJSON()).toEqual(source.toJSON());
    expect(manager.doc.getText('text').toString()).toContain('local');
    expect(manager.doc.getText('text').toString()).toContain('remote');
    expect(manager.doc.version().toJSON()).toEqual(source.version().toJSON());
  });

  it('keeps unavailable history unavailable after importing a valid shallow root', async () => {
    const source = createDocument();
    source.getText('text').insert(0, 'Retained content');
    source.commit();
    const root = source.oplogFrontiers();
    source.getText('text').insert(source.getText('text').length, ' later edit');
    source.commit();
    const snapshot = source.export({
      mode: 'shallow-snapshot',
      frontiers: root,
    });
    const manager = createManager();

    expect(await manager.ingest({ kind: 'dss', snapshot })).toBe(true);
    expect(manager.doc.isShallow()).toBe(true);
    expect(() => manager.doc.checkout([])).toThrow();
    expect(manager.doc.toJSON()).toEqual(source.toJSON());
  });

  it('retains pending dependency handling when the first received update is incomplete', () => {
    const source = createDocument();
    source.getText('text').insert(0, 'first');
    source.commit();
    const first = source.version();
    const predecessor = source.export({ mode: 'update' });
    source.getText('text').insert(5, ' second');
    source.commit();
    const manager = createManager();

    const pending = manager.importUpdate(
      source.export({ mode: 'update', from: first })
    );
    expect(pending.isErr() && pending.error[0]?.code).toBe(
      LoroManagerError.ImportPending
    );
    expect(manager.doc.isDetached()).toBe(false);
    expect(manager.importUpdate(predecessor).isOk()).toBe(true);
    expect(manager.doc.toJSON()).toEqual(source.toJSON());
  });

  it('rejects malformed input and remains attached for a later valid snapshot', async () => {
    const manager = createManager();
    const invalid = await manager.initializeFromSnapshot(
      new Uint8Array([1, 2])
    );
    expect(invalid.isErr() && invalid.error[0]?.code).toBe(
      LoroManagerError.ImportFailed
    );
    expect(manager.initialized).toBe(false);
    expect(manager.doc.isDetached()).toBe(false);

    const { source, snapshot } = independentHeadSnapshot(3);
    expect(await manager.ingest({ kind: 'dss', snapshot })).toBe(true);
    expect(manager.doc.toJSON()).toEqual(source.toJSON());
  });
});
