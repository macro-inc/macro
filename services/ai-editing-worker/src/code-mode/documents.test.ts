import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { LoroDoc, type LoroMap, type LoroMovableList } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  DocumentRequestError,
  type DocumentStorage,
} from '../document-storage';
import { runDocumentRequest } from './documents';
import { createSdk } from './sdk';

async function fixture(markdown = 'Existing paragraph.') {
  const live = new LoroDoc();
  live.import((await markdownToLoroSnapshot(markdown))!);
  let revision = 'r1';
  let commits = 0;
  let conflict = false;
  const storage: DocumentStorage = {
    async load() {
      return { snapshot: live.export({ mode: 'snapshot' }), revision };
    },
    async commit(expected, update) {
      if (conflict || expected !== revision)
        throw new DocumentRequestError('Conflict', 409);
      live.import(update);
      revision = `r${++commits + 1}`;
      return { revision, applied: true };
    },
  };
  const read = () =>
    runDocumentRequest(
      'doc',
      { action: 'read' },
      storage,
      new AbortController().signal
    );
  const sdk = createSdk(async (name, input) => {
    const args = input as { expectedRevision: string; operations: never[] };
    return runDocumentRequest(
      'doc',
      name === 'ReadDocumentState'
        ? { action: 'read' }
        : {
            action: 'edit',
            expectedRevision: args.expectedRevision,
            operations: args.operations,
          },
      storage,
      new AbortController().signal
    );
  });
  return {
    live,
    storage,
    read,
    sdk,
    get commits() {
      return commits;
    },
    conflict() {
      conflict = true;
    },
  };
}

describe('atomic document editing', () => {
  it('preserves editor handles across block retyping within one save', async () => {
    const f = await fixture('Existing paragraph.');
    try {
      const doc = await f.sdk.documents.open({ documentId: 'doc' });
      const id = doc.nodeIds[0]!;
      doc.editor.convertToHeading(id, 2);
      doc.editor.bold(id, 'Existing');
      doc.editor.replace(id, 'paragraph', 'heading');
      await expect(doc.save()).resolves.toMatchObject({ applied: true });
      expect(await f.read()).toMatchObject({
        xml: expect.stringContaining('heading'),
      });
    } finally {
      f.live.free();
    }
  });
  it('rejects missing IDs instead of returning ephemeral IDs', async () => {
    const f = await fixture();
    try {
      const children = f.live.getMap('root').get('children') as LoroMovableList;
      const paragraph = children.get(0) as LoroMap;
      (paragraph.get('$') as LoroMap).delete('id');
      f.live.commit();
      await expect(f.read()).rejects.toMatchObject({ status: 400 });
      expect(f.commits).toBe(0);
    } finally {
      f.live.free();
    }
  });

  it.each([false, true])(
    'rejects multiplicative edits targeting an inline ID: %s',
    async (inline) => {
      const f = await fixture(
        inline ? '**x**' + 'x'.repeat(10_000) : 'x'.repeat(10_000)
      );
      try {
        const doc = await f.sdk.documents.open({ documentId: 'doc' });
        doc.editor.replace(
          doc.nodeIds[inline ? 1 : 0]!,
          'x',
          'x'.repeat(65_536)
        );
        await expect(doc.save()).rejects.toMatchObject({ status: 413 });
        await expect(
          runDocumentRequest(
            'doc',
            {
              action: 'edit',
              expectedRevision: 'r1',
              operations: [
                {
                  kind: 'insertNode',
                  ref: 'table',
                  at: { appendToRoot: true },
                  spec: {
                    block: 'table',
                    rows: Array.from({ length: 100 }, () => Array(50).fill('')),
                  },
                },
              ],
            },
            f.storage,
            new AbortController().signal
          )
        ).rejects.toMatchObject({ status: 413 });
        expect(f.commits).toBe(0);
      } finally {
        f.live.free();
      }
    }
  );

  it('uses independent random peers for two edits prepared from one revision', async () => {
    const f = await fixture();
    const peers: string[] = [];
    try {
      const initial = await f.storage.load(new AbortController().signal);
      const existing = new Set(f.live.oplogVersion().toJSON().keys());
      const storage: DocumentStorage = {
        async load() {
          return initial;
        },
        async commit(expected, update, signal) {
          const candidate = new LoroDoc();
          try {
            candidate.import(initial.snapshot);
            candidate.import(update);
            peers.push(
              ...[...candidate.oplogVersion().toJSON().keys()].filter(
                (peer) => !existing.has(peer)
              )
            );
          } finally {
            candidate.free();
          }
          return f.storage.commit(expected, update, signal);
        },
      };
      const doc = await f.sdk.documents.open({ documentId: 'doc' });
      const results = await Promise.allSettled(
        ['one', 'two'].map((text) =>
          runDocumentRequest(
            'doc',
            {
              action: 'edit',
              expectedRevision: 'r1',
              operations: [{ kind: 'setText', node: doc.nodeIds[0]!, text }],
            },
            storage,
            new AbortController().signal
          )
        )
      );
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(new Set(peers).size).toBe(2);
      expect(
        peers.every(
          (p) =>
            BigInt(p) < 999999999999999000n || BigInt(p) > 999999999999999999n
        )
      ).toBe(true);
      expect(f.commits).toBe(1);
    } finally {
      f.live.free();
    }
  });

  it('reports safe editor mistakes with their operation index', async () => {
    const f = await fixture();
    try {
      const doc = await f.sdk.documents.open({ documentId: 'doc' });
      doc.editor.replace(doc.nodeIds[0]!, 'not present', 'replacement');
      await expect(doc.save()).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Operation 1:'),
      });
      expect(f.commits).toBe(0);
    } finally {
      f.live.free();
    }
  });

  it.each(['', '```ts\nconst n = 1;\n```'])(
    'keeps read IDs stable before saving %j',
    async (markdown) => {
      const f = await fixture(markdown);
      try {
        const first = await f.sdk.documents.open({ documentId: 'doc' });
        const second = await f.sdk.documents.open({ documentId: 'doc' });
        expect(first.nodeIds).toEqual(second.nodeIds);
        first.editor.setText(first.nodeIds[0]!, 'Changed existing block');
        expect(await first.save()).toMatchObject({ applied: true });
      } finally {
        f.live.free();
      }
    }
  );

  it('edits through the actual SDK, Lexical library and Loro delta and reads it back', async () => {
    const f = await fixture();
    try {
      const doc = await f.sdk.documents.open({ documentId: 'doc' });
      const ref = doc.editor.appendParagraph('Hello code mode');
      doc.editor.bold(ref, 'code mode');
      expect(await doc.save()).toMatchObject({ applied: true, revision: 'r2' });
      const state = await f.read();
      expect('xml' in state && state.xml).toContain('Hello');
      expect('xml' in state && state.xml).toContain('bold="true"');
      expect('xml' in state && state.xml).toContain('Existing paragraph.');
      expect(f.commits).toBe(1);
    } finally {
      f.live.free();
    }
  });

  it('never commits a partially valid batch or duplicate insertion ID', async () => {
    const f = await fixture();
    try {
      const before = JSON.stringify(f.live.toJSON());
      for (const duplicate of [false, true]) {
        const doc = await f.sdk.documents.open({ documentId: 'doc' });
        const ref = doc.editor.appendParagraph('Must not land');
        const operations = doc.editor.drain();
        await expect(
          runDocumentRequest(
            'doc',
            {
              action: 'edit',
              expectedRevision: doc.revision,
              operations: [
                ...operations,
                duplicate
                  ? operations[0]!
                  : { kind: 'setText', node: 'missing', text: ref },
              ],
            },
            f.storage,
            new AbortController().signal
          )
        ).rejects.toThrow();
        expect(JSON.stringify(f.live.toJSON())).toBe(before);
      }
      expect(f.commits).toBe(0);
    } finally {
      f.live.free();
    }
  });

  it('rejects a race at commit and stale handles without changing live state', async () => {
    const f = await fixture();
    try {
      const doc = await f.sdk.documents.open({ documentId: 'doc' });
      doc.editor.appendParagraph('Must not land');
      f.conflict();
      await expect(doc.save()).rejects.toThrow('Conflict');
      await expect(
        runDocumentRequest(
          'doc',
          {
            action: 'edit',
            expectedRevision: 'stale',
            operations: [{ kind: 'setText', node: 'x', text: 'x' }],
          },
          f.storage,
          new AbortController().signal
        )
      ).rejects.toMatchObject({ status: 409 });
      expect(f.commits).toBe(0);
    } finally {
      f.live.free();
    }
  });

  it('refuses unknown or malformed operations and honours cancellation', async () => {
    const f = await fixture();
    try {
      const invalid = {
        action: 'edit',
        expectedRevision: 'r1',
        operations: [{ kind: 'setText', node: 'x', text: 123 }],
      };
      await expect(
        runDocumentRequest(
          'doc',
          invalid as never,
          f.storage,
          new AbortController().signal
        )
      ).rejects.toThrow();
      await expect(
        runDocumentRequest(
          'doc',
          { action: 'read' },
          f.storage,
          AbortSignal.abort()
        )
      ).rejects.toThrow();
      expect(f.commits).toBe(0);
    } finally {
      f.live.free();
    }
  });
});
