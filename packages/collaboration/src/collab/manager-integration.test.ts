import { Mirror, schema } from '@loro-mirror/core';
import { LoroDoc, type VersionVector } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { noopChatter } from './chatter';
import { createSyncEngine } from './engine';
import { createLoroManager, type LoroManager } from './manager';
import { TestServer } from './test-utils/test-server';
import { InMemoryWALStore, WALSyncer } from './wal';

// mostly dummy schema that's flat so it's easy for tests
const TEST_SCHEMA = schema({
  paragraphs: schema.LoroList(
    schema.LoroMap({
      id: schema.String(),
      text: schema.LoroText(),
    }),
    (paragraph: { id: string }) => paragraph.id
  ),
});

function paragraphTexts(manager: LoroManager<typeof TEST_SCHEMA>): string[] {
  return manager.state?.state.paragraphs.map((p) => p.text) ?? [];
}

async function buildSnapshot(
  paragraphs: Array<{ id: string; text: string }>
): Promise<Uint8Array> {
  const doc = new LoroDoc();
  const mirror = new Mirror({ doc, schema: TEST_SCHEMA });
  mirror.setState({ paragraphs });
  await Promise.resolve();
  await Promise.resolve();
  return doc.export({ mode: 'snapshot' });
}

/** Push the full op-log from a manager to the server. Loro dedupes by op ID,
 *  so re-applying already-seen ops is a no-op. We use full-update mode (no
 *  `from` frontier) because Loro panics when the `from` frontier was derived
 *  from a snapshot import. */
function pushToServer(
  manager: LoroManager<typeof TEST_SCHEMA>,
  server: TestServer
) {
  server.applyUpdate(manager.doc.export({ mode: 'update' }));
}

describe('LoroManager seed + converge — two-client merge', () => {
  it('converges a stale local seed on engine startup without losing offline edits', async () => {
    const initialSnapshotX = await buildSnapshot([{ id: 'p1', text: 'X ' }]);
    const server = new TestServer();
    server.applyUpdate(initialSnapshotX);
    const live = server.asLiveSyncSource();
    const wal = new WALSyncer(new InMemoryWALStore<Uint8Array>(), (updates) =>
      live.pushUpdate(updates)
    );
    const onRemoteState = vi.fn();
    const { clientA, offlineClientB, reconnectedB, syncEngine, dispose } =
      createRoot((dispose) => {
        const reconnectedB = createLoroManager(TEST_SCHEMA, {
          documentId: 'test-doc-b-reconnected',
        });
        return {
          clientA: createLoroManager(TEST_SCHEMA, {
            documentId: 'test-doc-a',
          }),
          offlineClientB: createLoroManager(TEST_SCHEMA, {
            documentId: 'test-doc-b-offline',
          }),
          reconnectedB,
          syncEngine: createSyncEngine({
            loroManager: reconnectedB,
            awareness: {
              local: () => undefined,
              updateLocalAwareness: vi.fn(),
              getEncodedLocalAwareness: vi.fn(() => new Uint8Array()),
              importRemoteAwareness: vi.fn(),
            } as any,
            syncs: { wal, live },
            bindings: { onRemoteState },
            makeChatter: () => noopChatter(),
          }),
          dispose,
        };
      });

    await clientA.ingest({ kind: 'dss', snapshot: initialSnapshotX });
    await offlineClientB.ingest({
      kind: 'dss',
      snapshot: initialSnapshotX,
    });

    await offlineClientB.syncToLoro({
      paragraphs: [{ id: 'p1', text: 'X online-B ' }],
    });
    pushToServer(offlineClientB, server);

    await offlineClientB.syncToLoro({
      paragraphs: [{ id: 'p1', text: 'X online-B offline-B ' }],
    });
    const staleLocalSnapshot = offlineClientB.doc.export({
      mode: 'snapshot',
    });
    const versionAfterOfflineEdit = offlineClientB.doc.version();

    clientA.importUpdate(server.doc.export({ mode: 'update' }));
    await Promise.resolve();
    await clientA.syncToLoro({
      paragraphs: [{ id: 'p1', text: 'X online-B online-A ' }],
    });
    pushToServer(clientA, server);

    await reconnectedB.ingest({
      kind: 'local',
      snapshot: staleLocalSnapshot,
    });

    syncEngine.start();

    await vi.waitFor(() => {
      const finalText = paragraphTexts(reconnectedB)[0]!;
      expect(finalText).toContain('X');
      expect(finalText).toContain('online-B');
      expect(finalText).toContain('online-A');
      expect(finalText).toContain('offline-B');
    });
    expect(live.requestUpdatesSince).toHaveBeenCalledOnce();
    const requestedVersion = (
      live.requestUpdatesSince as unknown as {
        mock: { calls: [[VersionVector]] };
      }
    ).mock.calls[0][0];
    expect(requestedVersion.toJSON()).toEqual(versionAfterOfflineEdit.toJSON());

    await vi.waitFor(() => {
      const remoteText = onRemoteState.mock.lastCall?.[0].paragraphs[0].text;
      expect(remoteText).toContain('online-B');
      expect(remoteText).toContain('online-A');
      expect(remoteText).toContain('offline-B');
    });

    syncEngine.stop();
    wal.destroy();
    dispose();
  });

  it('two clients seeded from the same snapshot converge after concurrent edits', async () => {
    await createRoot(async (dispose) => {
      const initialSnapshotX = await buildSnapshot([{ id: 'p1', text: 'X ' }]);
      const server = new TestServer();
      server.applyUpdate(initialSnapshotX);

      const clientA = createLoroManager(TEST_SCHEMA, {
        documentId: 'test-doc-a',
      });
      await clientA.ingest({ kind: 'dss', snapshot: initialSnapshotX });

      const clientB = createLoroManager(TEST_SCHEMA, {
        documentId: 'test-doc-b',
      });
      await clientB.ingest({ kind: 'dss', snapshot: initialSnapshotX });

      await clientA.syncToLoro({
        paragraphs: [{ id: 'p1', text: 'X edit-A ' }],
      });
      pushToServer(clientA, server);

      await clientB.syncToLoro({
        paragraphs: [{ id: 'p1', text: 'X edit-B ' }],
      });
      pushToServer(clientB, server);

      // Both clients pull the full server state
      clientA.doc.import(server.doc.export({ mode: 'update' }));
      clientB.doc.import(server.doc.export({ mode: 'update' }));

      const textA = paragraphTexts(clientA)[0]!;
      const textB = paragraphTexts(clientB)[0]!;

      expect(textA).toContain('X');
      expect(textA).toContain('edit-A');
      expect(textA).toContain('edit-B');
      expect(textA).toEqual(textB);

      dispose();
    });
  });

  it('reports a causally pending update instead of treating it as a no-op', async () => {
    await createRoot(async (dispose) => {
      const source = new LoroDoc();
      source.setPeerId(7n);
      const text = source.getText('pending-test');
      text.insert(0, 'first');
      source.commit();
      const afterFirst = source.version();

      text.insert(text.length, ' second');
      source.commit();
      const updateMissingItsPredecessor = source.export({
        mode: 'update',
        from: afterFirst,
      });

      const manager = createLoroManager(TEST_SCHEMA, {
        documentId: 'test-doc-pending',
      });
      await manager.ingest({
        kind: 'dss',
        snapshot: await buildSnapshot([]),
      });

      const result = manager.importUpdate(updateMissingItsPredecessor);

      expect(result.isErr()).toBe(true);
      dispose();
    });
  });
});
