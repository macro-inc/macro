import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { DocumentEditor } from '@macro-inc/editor-ops/document';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import type { SerializedEditorState } from 'lexical';
import {
  LoroDoc,
  type LoroMap,
  type LoroMovableList,
  type LoroText,
  VersionVector,
} from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { createEditingSession, loadSnapshot } from '../ai-editing/ai-toolkit';
import { serializeWithXml } from '../ai-editing/utils';
import { applyDocumentOps } from './run';

const DOC = 'doc-1';

async function worker(snapshot: Uint8Array) {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: DOC });
  (await manager.initializeFromSnapshot(snapshot))._unsafeUnwrap();
  return manager;
}

function human(snapshot: Uint8Array): LoroDoc {
  const doc = new LoroDoc();
  doc.import(snapshot);
  return doc;
}

/** The document's XML view, as a caller reads it before building ops. */
function xml(manager: LoroManager<typeof MARKDOWN_LORO_SCHEMA>): string {
  const session = createEditingSession();
  loadSnapshot(
    session,
    manager.mirror!.getState() as unknown as SerializedEditorState
  );
  return serializeWithXml(session);
}

/** Ids of the document's top-level blocks, in order. */
function blockIds(view: string): string[] {
  return [...view.matchAll(/^ {2}<[\w-]+ id="([^"]+)"/gm)].map((m) => m[1]!);
}

/** The LoroText of the first block's first text node, as a typist edits it. */
function firstText(doc: LoroDoc): LoroText {
  const block = (doc.getMap('root').get('children') as LoroMovableList).get(
    0
  ) as LoroMap;
  const text = (block.get('children') as LoroMovableList).get(0) as LoroMap;
  return text.get('text') as LoroText;
}

function exchange(a: LoroDoc, b: LoroDoc) {
  const fromA = a.export({ mode: 'update', from: b.oplogVersion() });
  const fromB = b.export({ mode: 'update', from: a.oplogVersion() });
  a.import(fromB);
  b.import(fromA);
}

type Node = { text?: string; children?: Node[] };

function textOf(node: Node): string {
  return (node.text ?? '') + (node.children ?? []).map(textOf).join('|');
}

function text(doc: LoroDoc): string {
  return textOf((doc.toJSON() as { root: Node }).root);
}

describe('applyDocumentOps', () => {
  it('applies the batch and reaches other peers', async () => {
    const snapshot = (await markdownToLoroSnapshot('Ship in Q3.\n\n## Later'))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);
    const [paragraph, heading] = blockIds(xml(manager));

    const editor = new DocumentEditor({
      validIds: [paragraph!, heading!],
      refs: ['new-paragraph'],
    });
    editor.replace(paragraph!, 'Q3', 'Q4');
    editor.insertParagraphAfter(heading!, 'Next steps');

    const result = await applyDocumentOps(
      manager,
      createNoopLiveSyncSource(DOC),
      editor.drain()
    );
    exchange(manager.doc, peer);
    expect(result).toEqual({
      applied: 2,
      changedBlockIds: [paragraph, 'new-paragraph'],
      revision: expect.any(String),
    });
    // Encoded entry order varies; sync-service compares decoded versions too.
    const revision = 'revision' in result ? result.revision : '';
    expect(
      VersionVector.decode(Buffer.from(revision, 'base64')).compare(
        peer.oplogVersion()
      )
    ).toBe(0);
    expect(text(peer)).toBe('Ship in Q4.|Later|Next steps');
    expect(blockIds(xml(manager))).toEqual([
      paragraph,
      heading,
      'new-paragraph',
    ]);
    manager.dispose();
  });

  it('commits nothing and reports each failing op when any op fails', async () => {
    const snapshot = (await markdownToLoroSnapshot('Ship in Q3.'))!;
    const manager = await worker(snapshot);
    const [paragraph] = blockIds(xml(manager));
    const before = manager.doc.oplogVersion();

    const result = await applyDocumentOps(
      manager,
      createNoopLiveSyncSource(DOC),
      [
        {
          kind: 'replaceText',
          node: paragraph!,
          find: 'Q3',
          to: 'Q4',
          scope: { kind: 'all' },
        },
        { kind: 'setText', node: 'deleted-node', text: 'gone' },
        {
          kind: 'replaceText',
          node: paragraph!,
          find: 'Q9',
          to: 'Q10',
          scope: { kind: 'all' },
        },
      ]
    );

    expect(result).toEqual({
      failures: [
        {
          index: 1,
          kind: 'setText',
          message: expect.stringContaining('deleted-node'),
        },
        { index: 2, kind: 'replaceText', message: expect.any(String) },
      ],
    });
    expect(manager.doc.oplogVersion().compare(before)).toBe(0);
    expect(xml(manager)).toContain('Ship in Q3.');
    manager.dispose();
  });

  it('builds on an edit that landed just before and merges typing during it', async () => {
    const snapshot = (await markdownToLoroSnapshot('Ship in Q3.\n\n## Later'))!;
    const manager = await worker(snapshot);
    const peer = human(snapshot);
    const [paragraph, heading] = blockIds(xml(manager));

    // Typed and synced before the batch: the batch targets this text.
    firstText(peer).insert('Ship in Q3.'.length - 1, ', maybe');
    peer.commit();
    exchange(manager.doc, peer);

    // Typed while the batch runs, reaching the worker only afterwards.
    firstText(peer).insert(0, 'We ');
    peer.commit();

    const result = await applyDocumentOps(
      manager,
      createNoopLiveSyncSource(DOC),
      [
        {
          kind: 'replaceText',
          node: paragraph!,
          find: 'maybe',
          to: 'surely',
          scope: { kind: 'all' },
        },
        { kind: 'appendText', node: heading!, text: ' on' },
      ]
    );
    expect(result).toMatchObject({
      applied: 2,
      changedBlockIds: [paragraph, heading],
    });

    exchange(manager.doc, peer);
    expect(manager.doc.toJSON()).toEqual(peer.toJSON());
    expect(text(peer)).toBe('We Ship in Q3, surely.|Later on');
    manager.dispose();
  });

  it('inserts a saved database question passed as a handle', async () => {
    const snapshot = (await markdownToLoroSnapshot('Pipeline'))!;
    const manager = await worker(snapshot);
    const [paragraph] = blockIds(xml(manager));
    const savedQuery = {
      toBlock: () =>
        '<m-db-query>{"queryId":"q-1","databaseId":"db-1","prompt":"Projects per owner","displayMode":"bar","chart":{"x":"owner","y":["projects"]}}</m-db-query>',
    };

    const editor = new DocumentEditor({
      validIds: [paragraph!],
      refs: ['answer'],
    });
    editor.insertDatabaseQueryAfter(paragraph!, savedQuery);

    const result = await applyDocumentOps(
      manager,
      createNoopLiveSyncSource(DOC),
      editor.drain()
    );
    expect(result).toMatchObject({
      applied: 1,
      changedBlockIds: ['answer'],
    });
    const view = xml(manager);
    expect(blockIds(view)).toEqual([paragraph, 'answer']);
    expect(view).toMatch(/<database-query id="answer"[^>]*queryId="q-1"/);
    manager.dispose();
  });
});
