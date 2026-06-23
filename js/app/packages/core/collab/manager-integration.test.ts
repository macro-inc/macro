import { Mirror, schema } from '@loro-mirror/packages/core/src';
import { LoroDoc } from 'loro-crdt';
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
  it('two clients seeded from the same snapshot converge after concurrent edits', async () => {
    await createRoot(async (dispose) => {
      const initialSnapshotX = await buildSnapshot([{ id: 'p1', text: 'X ' }]);
      const server = new TestServer();
      server.applyUpdate(initialSnapshotX);

      const clientA = createLoroManager(TEST_SCHEMA, { documentId: 'test-doc-a' });
      await clientA.ingest({ kind: 'dss', snapshot: initialSnapshotX });

      const clientB = createLoroManager(TEST_SCHEMA, { documentId: 'test-doc-b' });
      await clientB.ingest({ kind: 'dss', snapshot: initialSnapshotX });

      await clientA.syncToLoro({ paragraphs: [{ id: 'p1', text: 'X edit-A ' }] });
      pushToServer(clientA, server);

      await clientB.syncToLoro({ paragraphs: [{ id: 'p1', text: 'X edit-B ' }] });
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
});
