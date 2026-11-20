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

type Node = {
  $?: { id: string };
  type?: string;
  ids?: string[];
  text?: string;
  children?: Node[];
};

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

/**
 * Internal markdown with the rich nodes an agent reads: mentions in a
 * paragraph, a table with a mention in a cell, a date, equations, a link, an
 * uploaded image, a checklist and code.
 */
const RICH_BODY = [
  '# Launch',
  'Owner: <m-user-mention>{"userId":"macro|bob@example.com","email":"bob@example.com"}</m-user-mention>, spec <m-document-mention>{"documentId":"01a19313-9b37-7e60-b932-bf486394ba48","blockName":"md","documentName":"Spec","blockParams":{}}</m-document-mention>, due <m-date-mention>{"date":"2026-11-13","displayFormat":"Fri, Nov 13"}</m-date-mention>.',
  '<m-table><m-table-row><m-table-cell header="row">Who</m-table-cell><m-table-cell header="row">What</m-table-cell></m-table-row><m-table-row><m-table-cell><m-user-mention>{"userId":"macro|ann@example.com","email":"ann@example.com"}</m-user-mention></m-table-cell><m-table-cell>Docs</m-table-cell></m-table-row></m-table>',
  'Growth is $e^{x}$, see <m-link>{"url":"https://example.com","text":"the site"}</m-link>.',
  '$$\nx^2\n$$',
  '<m-image>{"url":"https://signed.example.com/x","alt":"shot","srcType":"dss","id":"img-1"}</m-image>',
  '- [ ] Write the post\n- [x] Pick a date',
  '```ts\nconst done = true;\n```',
].join('\n\n');

function nodesOfType(doc: LoroDoc, type: string): Node[] {
  return walk({ children: blocks(doc) }).filter((node) => node.type === type);
}

describe('agent read and write back', () => {
  it('writes back the unchanged body without a commit, keeping every rich node', async () => {
    const synced = new SyncedDocument(
      (await markdownToLoroSnapshot(RICH_BODY))!
    );
    const before = synced.doc.export({ mode: 'snapshot' });

    const read = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    if (read.action !== 'read') throw new Error('expected a read');
    expect(read.markdown).toContain('<m-user-mention>');
    expect(read.markdown).toContain('<m-table>');

    const written = await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: read.revision,
        markdown: read.markdown,
      },
      synced,
      signal()
    );

    expect(written).toEqual({
      action: 'write',
      revision: read.revision,
      changed: false,
    });
    expect(synced.commits).toBe(0);
    expect(synced.doc.export({ mode: 'snapshot' })).toEqual(before);
  });

  it('keeps mentions as mention nodes when a line beside them is edited', async () => {
    const synced = new SyncedDocument(
      (await markdownToLoroSnapshot(RICH_BODY))!
    );
    const read = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    if (read.action !== 'read') throw new Error('expected a read');
    const mentionsBefore = nodesOfType(synced.doc, 'user-mention').length;

    await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: read.revision,
        markdown: read.markdown.replace('# Launch', '# Launch plan'),
      },
      synced,
      signal()
    );

    expect(synced.commits).toBe(1);
    expect(mentionsBefore).toBe(2);
    expect(nodesOfType(synced.doc, 'user-mention')).toHaveLength(2);
    const reread = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    if (reread.action !== 'read') throw new Error('expected a read');
    expect(reread.markdown).toBe(
      read.markdown.replace('# Launch', '# Launch plan')
    );
  });
});

describe('pipe tables', () => {
  it('writes a GitHub pipe table as a table, with chips, escapes and empty cells', async () => {
    const synced = new SyncedDocument((await markdownToLoroSnapshot('Map'))!);
    const { revision } = await synced.load();

    await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: revision,
        markdown: [
          'Map',
          '',
          '| Task | Owner | Notes |',
          '| --- | :---: | --- |',
          '| <m-document-mention>{"documentId":"01a19313-9b37-7e60-b932-bf486394ba48","blockName":"task","blockParams":{}}</m-document-mention> | <m-user-mention>{"userId":"macro|ann@example.com","email":"ann@example.com"}</m-user-mention> | a \\| b |',
          '| Paths | C:\\\\temp | |',
        ].join('\n'),
      },
      synced,
      signal()
    );

    const [, table] = blocks(synced.doc);
    expect(table.type).toBe('table');
    const rows = (table.children ?? []).map((row) =>
      (row.children ?? []).map(textOf)
    );
    expect(rows).toEqual([
      ['Task', 'Owner', 'Notes'],
      ['', '', 'a | b'],
      ['Paths', 'C:\\temp', ''],
    ]);
    const [taskCell, ownerCell] = table.children?.[1].children ?? [];
    expect(walk(taskCell).map((node) => node.type)).toContain(
      'document-mention'
    );
    expect(walk(ownerCell).map((node) => node.type)).toContain('user-mention');
  });

  it('keeps ids, comments and an existing table when a pipe table is added', async () => {
    const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: DOC });
    (
      await manager.initializeFromSnapshot(
        (await markdownToLoroSnapshot(
          '# Plan\n\n<m-table><m-table-row><m-table-cell header="row">Who</m-table-cell></m-table-row><m-table-row><m-table-cell>Ann</m-table-cell></m-table-row></m-table>\n\nThe quick brown fox.'
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
    const [heading, existingTable, fox] = blocks(synced.doc);
    const read = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    if (read.action !== 'read') throw new Error('expected a read');

    await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: read.revision,
        markdown: `${read.markdown}\n\n| Step | Done |\n|---|---|\n| Ship | yes |`,
      },
      synced,
      signal()
    );

    const after = blocks(synced.doc);
    expect(after.map((block) => block.type)).toEqual([
      'heading',
      'table',
      'paragraph',
      'table',
    ]);
    expect(after[0].ids).toEqual(heading.ids);
    expect(after[1]).toEqual(existingTable);
    expect(after[2]).toEqual(fox);
    const marks = walk(after[2]).filter((n) => n.type === 'comment-mark');
    expect(marks[0].ids).toEqual([MARK]);
    expect(after[3].children?.map((row) => row.children?.map(textOf))).toEqual([
      ['Step', 'Done'],
      ['Ship', 'yes'],
    ]);

    const reread = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    if (reread.action !== 'read') throw new Error('expected a read');
    const commits = synced.commits;
    const rewritten = await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: reread.revision,
        markdown: reread.markdown,
      },
      synced,
      signal()
    );
    expect(rewritten).toMatchObject({ changed: false });
    expect(synced.commits).toBe(commits);
  });

  it('keeps a commented pipe-delimited paragraph as text when written back', async () => {
    const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: DOC });
    (
      await manager.initializeFromSnapshot(
        (await markdownToLoroSnapshot('# Plan\n\n\\| plain text |'))!
      )
    )._unsafeUnwrap();
    await applyCommentMarkChange(manager, createNoopLiveSyncSource(DOC), {
      action: 'add',
      markId: MARK,
      text: 'plain text',
    });
    const synced = new SyncedDocument(manager.doc.export({ mode: 'snapshot' }));
    manager.dispose();
    const [, paragraph] = blocks(synced.doc);
    const read = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    if (read.action !== 'read') throw new Error('expected a read');
    expect(read.markdown).toBe('# Plan\n\n| plain text |');

    const unchanged = await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: read.revision,
        markdown: read.markdown,
      },
      synced,
      signal()
    );
    expect(unchanged).toMatchObject({ changed: false });

    await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: read.revision,
        markdown: read.markdown.replace('# Plan', '# Launch plan'),
      },
      synced,
      signal()
    );
    const after = blocks(synced.doc);
    expect(after[1]).toEqual(paragraph);
    expect(after[1].type).toBe('paragraph');
    const marks = walk(after[1]).filter((n) => n.type === 'comment-mark');
    expect(marks[0].ids).toEqual([MARK]);
  });

  it('starts a new table for a pipe table on the line after an existing one', async () => {
    const synced = new SyncedDocument(
      (await markdownToLoroSnapshot(
        '<m-table><m-table-row><m-table-cell>Old</m-table-cell></m-table-row></m-table>'
      ))!
    );
    const [existing] = blocks(synced.doc);
    const read = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    if (read.action !== 'read') throw new Error('expected a read');

    await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: read.revision,
        markdown: `${read.markdown}\n| Header |\n| --- |\n| New |`,
      },
      synced,
      signal()
    );

    const after = blocks(synced.doc);
    expect(after.map((block) => block.type)).toEqual(['table', 'table']);
    expect(after[0].$).toEqual(existing.$);
    expect(after[0].children?.map((row) => row.children?.map(textOf))).toEqual([
      ['Old'],
    ]);
    expect(after[1].children?.map((row) => row.children?.map(textOf))).toEqual([
      ['Header'],
      ['New'],
    ]);
  });

  it('keeps table-shaped text already in a paragraph as text, with its comment', async () => {
    const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: DOC });
    (
      await manager.initializeFromSnapshot(
        (await markdownToLoroSnapshot(
          '# Plan\n\n\\| Header |\n\\| --- |\n\\| Body |'
        ))!
      )
    )._unsafeUnwrap();
    await applyCommentMarkChange(manager, createNoopLiveSyncSource(DOC), {
      action: 'add',
      markId: MARK,
      text: 'Body',
    });
    const synced = new SyncedDocument(manager.doc.export({ mode: 'snapshot' }));
    manager.dispose();
    const [, paragraph] = blocks(synced.doc);
    expect(paragraph.type).toBe('paragraph');
    const read = await runMarkdownRequest(
      DOC,
      { action: 'read' },
      synced,
      signal()
    );
    if (read.action !== 'read') throw new Error('expected a read');

    const unchanged = await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: read.revision,
        markdown: read.markdown,
      },
      synced,
      signal()
    );
    expect(unchanged).toMatchObject({ changed: false });

    await runMarkdownRequest(
      DOC,
      {
        action: 'write',
        expectedRevision: read.revision,
        markdown: read.markdown.replace('# Plan', '# Updated'),
      },
      synced,
      signal()
    );
    const after = blocks(synced.doc);
    expect(after.map((block) => block.type)).toEqual(['heading', 'paragraph']);
    expect(after[1]).toEqual(paragraph);
    const marks = walk(after[1]).filter((n) => n.type === 'comment-mark');
    expect(marks[0].ids).toEqual([MARK]);
  });
});
