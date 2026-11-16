import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import { applyCommentMarkChange } from '../comment-mark/run';
import { SyncDocumentError, type SyncDocumentStorage } from '../sync-document';
import { runMarkdownRequest } from './body';

const DOC = 'doc-1';
const MARK = '0199a1b2-0000-7000-8000-000000000001';

type Node = { type?: string; ids?: string[]; text?: string; children?: Node[] };

function revisionOf(doc: LoroDoc): string {
  return btoa(String.fromCharCode(...doc.oplogVersion().encode()));
}

/** Sync-service's document: commits apply only at the revision they name. */
class SyncedDocument implements SyncDocumentStorage {
  readonly doc = new LoroDoc();
  commits = 0;

  constructor(snapshot: Uint8Array) {
    this.doc.import(snapshot);
  }

  async load() {
    return {
      snapshot: this.doc.export({ mode: 'snapshot' }),
      revision: revisionOf(this.doc),
    };
  }

  async commit(expectedRevision: string, update: Uint8Array) {
    if (expectedRevision !== revisionOf(this.doc))
      throw new SyncDocumentError('conflict', 409, 'edit');
    this.doc.import(update);
    this.commits++;
    return { revision: revisionOf(this.doc), applied: true };
  }
}

function blocks(doc: LoroDoc): Node[] {
  return (doc.toJSON() as { root: Node }).root.children ?? [];
}

function walk(node: Node, out: Node[] = []): Node[] {
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}

function textOf(node: Node): string {
  return (node.text ?? '') + (node.children ?? []).map(textOf).join('');
}

const signal = () => new AbortController().signal;

describe('runMarkdownRequest', () => {
  it('reads the body as markdown with the revision it was read at', async () => {
    const synced = new SyncedDocument(
      (await markdownToLoroSnapshot('# Plan\n\nShip the **beta**.'))!
    );

    const read = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );

    expect(read).toEqual({
      action: 'read',
      markdown: '# Plan\n\nShip the **beta**.',
      revision: revisionOf(synced.doc),
    });
  });

  it('replaces only the changed blocks, keeping a comment mark in an untouched one', async () => {
    const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: DOC });
    (
      await manager.initializeFromSnapshot(
        (await markdownToLoroSnapshot(
          '# Plan\n\nShip the beta.\n\nThe quick brown fox.'
        ))!
      )
    )._unsafeUnwrap();
    await applyCommentMarkChange(manager, createNoopLiveSyncSource(DOC), {
      action: 'add',
      markId: MARK,
      text: 'brown fox',
    });
    const synced = new SyncedDocument(manager.doc.export({ mode: 'snapshot' }));
    manager.dispose();
    const [heading, , fox] = blocks(synced.doc);

    const read = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    expect(read).toMatchObject({
      markdown: '# Plan\n\nShip the beta.\n\nThe quick brown fox.',
    });
    const written = await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: read.revision,
        markdown: '# Plan\n\nShip the beta on Friday.\n\nThe quick brown fox.',
      },
      synced,
      signal()
    );

    expect(written).toEqual({
      action: 'write',
      revision: revisionOf(synced.doc),
      changed: true,
    });
    const after = blocks(synced.doc);
    expect(after.map(textOf)).toEqual([
      'Plan',
      'Ship the beta on Friday.',
      'The quick brown fox.',
    ]);
    expect(after[0].ids).toEqual(heading.ids);
    expect(after[2].ids).toEqual(fox.ids);
    const marks = walk(after[2]).filter((n) => n.type === 'comment-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].ids).toEqual([MARK]);
    expect(textOf(marks[0])).toBe('brown fox');
  });

  it('inserts, moves past and removes blocks in document order', async () => {
    const synced = new SyncedDocument(
      (await markdownToLoroSnapshot('One\n\nTwo\n\nThree'))!
    );
    const { revision } = await synced.load();

    await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: revision,
        markdown: 'Zero\n\nOne\n\nThree\n\n- four\n- five',
      },
      synced,
      signal()
    );

    const read = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    expect(read).toMatchObject({
      markdown: 'Zero\n\nOne\n\nThree\n\n- four\n- five',
    });
  });

  it('refuses a write from a stale read without committing', async () => {
    const synced = new SyncedDocument(
      (await markdownToLoroSnapshot('Ship the beta.'))!
    );
    const stale = await synced.load();
    const typing = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: DOC });
    (await typing.initializeFromSnapshot(stale.snapshot))._unsafeUnwrap();
    await applyCommentMarkChange(typing, createNoopLiveSyncSource(DOC), {
      action: 'add',
      markId: MARK,
      text: 'beta',
    });
    synced.doc.import(typing.doc.export({ mode: 'update' }));
    typing.dispose();

    await expect(
      runMarkdownRequest(
        DOC,
        {
          action: 'write',
          expectedRevision: stale.revision,
          markdown: 'Ship the release.',
        },
        synced,
        signal()
      )
    ).rejects.toMatchObject({ failure: 'conflict', status: 409 });
    expect(synced.commits).toBe(0);
    expect(textOf({ children: blocks(synced.doc) })).toBe('Ship the beta.');
  });

  it('commits nothing when the body already reads that way', async () => {
    const synced = new SyncedDocument(
      (await markdownToLoroSnapshot('# Plan\n\nShip the beta.'))!
    );
    const { revision } = await synced.load();

    const written = await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: revision,
        markdown: '# Plan\n\nShip the beta.',
      },
      synced,
      signal()
    );

    expect(written).toEqual({ action: 'write', revision, changed: false });
    expect(synced.commits).toBe(0);
  });
});
