import { Mirror, schema } from '@loro-mirror/packages/core/src';
import { LoroDoc, type VersionVector } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createLoroManager, type LoroManager } from './manager';
import { TestServer } from './test-utils/test-server';

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
  return manager.state()?.state.paragraphs.map((p) => p.text) ?? [];
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
  server.applyUpdate(manager.getDoc().export({ mode: 'update' }));
}

describe('LoroManager + DocInitMachine — two-client merge', () => {
  it("client B reconnects dirty: requestUpdatesSince merges its offline edits with A's concurrent edits", async () => {
    await createRoot(async (dispose) => {
      // ── X: shared initial snapshot ────────────────────────────────────
      const initialSnapshotX = await buildSnapshot([{ id: 'p1', text: 'X ' }]);
      const server = new TestServer();
      server.applyUpdate(initialSnapshotX);

      // ── Client A — always online ──────────────────────────────────────
      const clientA = createLoroManager(TEST_SCHEMA, {
        liveSyncSource: () => server.asLiveSyncSource(),
        wasDirty: false,
      });
      await clientA.ingest({ kind: 'dss', snapshot: initialSnapshotX });

      // ── Client B — will go offline ────────────────────────────────────
      const clientB = createLoroManager(TEST_SCHEMA, {
        liveSyncSource: () => server.asLiveSyncSource(),
        wasDirty: false,
      });
      await clientB.ingest({ kind: 'dss', snapshot: initialSnapshotX });

      // ── B makes an online edit, pushed to the server ──────────────────
      await clientB.syncToLoro({
        paragraphs: [{ id: 'p1', text: 'X online-B ' }],
      });
      pushToServer(clientB, server);

      // ── B goes offline; this edit never reaches the server ────────────
      await clientB.syncToLoro({
        paragraphs: [{ id: 'p1', text: 'X online-B offline-B ' }],
      });
      const offlineSnapshotFromB = clientB
        .getDoc()
        .export({ mode: 'snapshot' });
      const bVvAfterOffline = clientB.getDoc().version();

      // ── A receives B's online-B from server (via full update import) ─
      clientA.getDoc().import(server.doc.export({ mode: 'update' }));
      // ── A makes its own edit and pushes ───────────────────────────────
      await clientA.syncToLoro({
        paragraphs: [{ id: 'p1', text: 'X online-B online-A ' }],
      });
      pushToServer(clientA, server);

      // ── B reconnects: fresh manager seeded with wasDirty=true ─────────
      const reconnectSource = server.asLiveSyncSource();
      const reconnectedB = createLoroManager(TEST_SCHEMA, {
        liveSyncSource: () => reconnectSource,
        wasDirty: true,
      });

      await reconnectedB.ingest({
        kind: 'local',
        snapshot: offlineSnapshotFromB,
      });

      // ── Assertions ────────────────────────────────────────────────────

      // 1. The state machine triggered exactly one requestUpdatesSince.
      expect(reconnectSource.requestUpdatesSince).toHaveBeenCalledTimes(1);

      // 2. It was called with B's post-offline version vector (so the
      //    server's delta excludes anything B already has).
      const requestedVv = (
        reconnectSource.requestUpdatesSince as unknown as {
          mock: { calls: unknown[][] };
        }
      ).mock.calls[0]?.[0] as VersionVector;
      expect(requestedVv.toJSON()).toEqual(bVvAfterOffline.toJSON());

      // 3. Final state contains substrings contributed by every side.
      const finalText = paragraphTexts(reconnectedB)[0]!;
      expect(finalText).toContain('X'); // shared base
      expect(finalText).toContain('online-B'); // B's online edit
      expect(finalText).toContain('offline-B'); // B's local-only offline edit
      expect(finalText).toContain('online-A'); // A's edit B missed

      dispose();
    });
  });
});
