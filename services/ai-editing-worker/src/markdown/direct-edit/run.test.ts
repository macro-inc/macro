import { isAiPeer } from '@macro-inc/collaboration/collab/ai-peer';
import { NOOP_SPAN } from '@macro-inc/observability';
import { decodeImportBlobMeta } from 'loro-crdt';
import { beforeAll, describe, expect, it } from 'vitest';
import { type DocumentView, readDocument } from './document';
import type { DirectEdit } from './edits';
import { EditRefusal } from './edits';
import {
  buildSnapshot,
  RICH_COMMENTS,
  richSnapshot,
  SyncedDocument,
} from './fixtures/build';
import {
  asConflict,
  checkPositionalIds,
  DirectEditConflict,
  type DirectEditRequest,
  InvalidBaseRevision,
  readMarkdownBlocks,
  runDirectEdit,
} from './run';

const DOC = 'doc-1';
const signal = () => new AbortController().signal;

let base: Uint8Array;
let view: DocumentView;

beforeAll(async () => {
  base = await richSnapshot();
  view = await readDocument(DOC, base);
});

function find(v: DocumentView, needle: string) {
  const block = v.blocks.find((b) => b.markdown.includes(needle));
  if (!block) throw new Error(`no block containing ${needle}`);
  return block;
}

async function run(
  request: DirectEditRequest,
  synced = new SyncedDocument(base)
) {
  const response = await runDirectEdit(
    DOC,
    request,
    synced,
    signal(),
    NOOP_SPAN
  );
  return {
    response,
    synced,
    after: await readDocument(DOC, synced.snapshot()),
  };
}

async function refusal(
  edits: DirectEdit[],
  options: Partial<DirectEditRequest> = {}
) {
  const synced = new SyncedDocument(base);
  const error = await runDirectEdit(
    DOC,
    { edits, ...options },
    synced,
    signal(),
    NOOP_SPAN
  ).catch((e: unknown) => e);
  expect(synced.commits).toBe(0);
  expect(error).toBeInstanceOf(EditRefusal);
  return error as EditRefusal;
}

describe('the fixture', () => {
  it('has 19 blocks, one of them opaque (a plain mark), and three comment marks', () => {
    expect(view.blocks.length).toBe(19);
    expect(view.blocks.filter((b) => b.opaque).map((b) => b.type)).toEqual([
      'paragraph',
    ]);
    expect(new Set(view.blocks.flatMap((b) => b.commentIds))).toEqual(
      new Set(RICH_COMMENTS.map((c) => c.id))
    );
  });

  it('reads as blocks, the opaque one as a keep placeholder', async () => {
    const read = await readMarkdownBlocks(
      DOC,
      new SyncedDocument(base),
      signal()
    );
    const opaque = view.blocks.find((b) => b.opaque);
    expect(read.blocks.length).toBe(19);
    expect(read.blocks.find((b) => b.id === opaque.id)).toEqual({
      id: opaque.id,
      type: 'paragraph',
      markdown: `<!-- keep:${opaque.id} -->`,
      opaque: true,
    });
    expect(read.blocks[0]).toEqual({
      id: view.blocks[0].id,
      type: 'heading',
      markdown: '# Garden Plan',
    });
  });
});

describe('a replace inside a block', () => {
  it('replaces the text in place: the block keeps its id, node ids and comment mark', async () => {
    const intro = find(view, 'Intro paragraph');
    const { response, after } = await run({
      edits: [{ old: 'comment target here', new: 'comment goal here' }],
    });

    expect(response.outcome).toBe('committed');
    expect(response.merge).toBe('current');
    expect(response.changes).toEqual([
      {
        kind: 'edited',
        blockId: intro.id,
        before: intro.markdown,
        after: intro.markdown.replace('target', 'goal'),
      },
    ]);
    const edited = after.blocks.find((b) => b.id === intro.id);
    expect(edited.markdown).toBe(intro.markdown.replace('target', 'goal'));
    expect(edited.nodeIds).toEqual(intro.nodeIds);
    expect(edited.commentIds).toEqual(['cm-intro']);
    expect(after.blocks.map((b) => b.id)).toEqual(view.blocks.map((b) => b.id));
  });

  // Every rich block kind: a needle locating it and an edit inside it.
  const KINDS: [
    kind: string,
    needle: string,
    old: string,
    replacement: string,
  ][] = [
    ['heading', '# Garden Plan', 'Garden Plan', 'Garden Plans'],
    [
      'user mention + comment',
      'Intro paragraph',
      'Intro paragraph',
      'Opening paragraph',
    ],
    ['group + contact mention', 'Group:', 'Group:', 'Team:'],
    [
      'document + date mention',
      '<m-document-mention>',
      ' before ',
      ' ahead of ',
    ],
    ['inline format, equation, link', 'Inline math', '**bold**', '**heavy**'],
    ['bullet list + comment', '- Tomatoes', 'Beans', 'Peas'],
    ['ordered list', '1. Dig', 'Plant', 'Sow'],
    ['check list', 'Buy compost', '- [ ] Buy', '- [x] Buy'],
    ['quote', '> A quoted', 'soil', 'loam'],
    ['table with merged cells + comment', '<m-table>', 'Chard', 'Spinach'],
    ['image alt', '![A bed diagram]', 'A bed diagram', 'Bed layout'],
    ['video', '<m-video>', 'tour.mp4', 'walk.mp4'],
    ['code', '```python', 'bed * 2', 'bed * 3'],
    ['block equation', '<m-katex-equation>', 'V = l', 'U = l'],
    ['document card', '<m-document-card>', 'Harvest Log', 'Harvest Diary'],
  ];
  for (const [kind, needle, old, replacement] of KINDS)
    it(`${kind}: keeps its id and comment marks, every other block untouched`, async () => {
      const target = find(view, needle);
      const { after } = await run({
        edits: [{ block_id: target.id, old, new: replacement }],
      });
      const i = view.blocks.indexOf(target);
      expect(after.blocks[i].id).toBe(target.id);
      expect(after.blocks[i].markdown).toBe(
        target.markdown.replace(old, replacement)
      );
      expect(after.blocks[i].commentIds).toEqual(target.commentIds);
      for (const tag of target.markdown.match(/<m-[a-z-]+>/g) ?? [])
        expect(after.blocks[i].markdown).toContain(tag);
      view.blocks.forEach((block, j) => {
        if (j !== i) expect(after.blocks[j]).toEqual(block);
      });
    });

  it('bolding a word in a commented paragraph keeps the mark', async () => {
    const intro = find(view, 'Intro paragraph');
    const { after } = await run({
      edits: [{ old: 'invented garden', new: 'invented **garden**' }],
    });
    const edited = after.blocks.find((b) => b.id === intro.id);
    expect(edited.markdown).toContain('invented **garden** plan');
    expect(edited.commentIds).toEqual(['cm-intro']);
  });

  it('renaming the commented list item keeps the list id and the mark', async () => {
    const list = find(view, '- Tomatoes');
    const { after } = await run({
      edits: [{ old: 'Peppers', new: 'Chilies' }],
    });
    const edited = after.blocks.find((b) => b.id === list.id);
    expect(edited.markdown).toBe(list.markdown.replace('Peppers', 'Chilies'));
    expect(edited.commentIds).toEqual(['cm-list']);
  });

  it('adding a list item keeps every existing item id', async () => {
    const list = find(view, '1. Dig');
    const { after } = await run({
      edits: [{ old: '3. Water', new: '3. Water\n4. Mulch' }],
    });
    const edited = after.blocks.find((b) => b.id === list.id);
    expect(edited.markdown).toBe('1. Dig\n2. Plant\n3. Water\n4. Mulch');
    for (const id of list.nodeIds) expect(edited.nodeIds).toContain(id);
  });

  it('editing the commented table cell keeps the table, its cells, spans and mark', async () => {
    const table = find(view, '<m-table>');
    const { after } = await run({ edits: [{ old: 'Kale', new: 'Cabbage' }] });
    const edited = after.blocks.find((b) => b.id === table.id);
    expect(edited.commentIds).toEqual(['cm-table']);
    expect(edited.nodeIds.length).toBe(table.nodeIds.length);
    expect(edited.markdown).toContain('rowspan="2"');
    expect(edited.markdown).toContain('colspan="2"');
  });

  it('inserting a mention next to existing ones keeps the paragraph', async () => {
    const group = find(view, 'Group:');
    const mention =
      ' <m-user-mention>{"userId":"macro|ann@example.com","email":"ann@example.com","displayName":"Ann Example"}</m-user-mention>';
    const { after } = await run({
      edits: [{ old: 'and contact', new: `and${mention} and contact` }],
    });
    const edited = after.blocks.find((b) => b.id === group.id);
    expect(edited.markdown).toBe(
      group.markdown.replace('and contact', `and${mention} and contact`)
    );
  });

  it('retyping a paragraph as a heading rebuilds that block', async () => {
    const closing = find(view, 'Closing paragraph');
    const { after } = await run({
      edits: [
        {
          block_id: closing.id,
          old: 'Closing paragraph',
          new: '## Closing paragraph',
        },
      ],
    });
    expect(after.blocks.at(-1).markdown).toBe(
      '## Closing paragraph with a final note.'
    );
    expect(after.blocks.at(-1).type).toBe('heading');
  });

  it('replace_all changes every occurrence', async () => {
    const { after } = await run({
      edits: [{ old: 'bed', new: 'plot', replace_all: true }],
    });
    expect(after.blocks.some((b) => /\bbed\b/.test(b.markdown))).toBe(false);
  });

  it('an old text spanning two blocks merges them', async () => {
    const { after } = await run({
      edits: [
        { old: 'final note.', new: 'final note.' },
        { old: '---\n\nClosing', new: 'Closing' },
      ],
    });
    expect(after.blocks.at(-1).markdown).toBe(
      'Closing paragraph with a final note.'
    );
    expect(after.blocks.length).toBe(18);
  });
});

describe('inserts, deletes and moves', () => {
  it('insert at start and end, and a move, in one batch: moved block keeps its ids', async () => {
    const quote = find(view, '> A quoted');
    const heading = view.blocks[0];
    const intro = find(view, 'Intro paragraph');
    const { after, response } = await run({
      edits: [
        { insert_before: 'start', markdown: '# New top' },
        { insert_after: 'end', markdown: 'Footer one.\n\nFooter two.' },
        { move: quote.id, before: heading.id },
        { old: 'comment target here', new: 'comment goal here' },
      ],
    });
    expect(after.blocks.map((b) => b.markdown).slice(0, 3)).toEqual([
      '# New top',
      quote.markdown,
      heading.markdown,
    ]);
    expect(after.blocks[1].id).toBe(quote.id);
    expect(after.blocks[1].nodeIds).toEqual(quote.nodeIds);
    expect(after.blocks.slice(-2).map((b) => b.markdown)).toEqual([
      'Footer one.',
      'Footer two.',
    ]);
    expect(after.blocks.find((b) => b.id === intro.id).commentIds).toEqual([
      'cm-intro',
    ]);
    expect(response.changes.map((c) => c.kind).sort()).toEqual(
      ['edited', 'inserted', 'inserted', 'inserted', 'moved'].sort()
    );
  });

  it('a new block next to each kind leaves the kind untouched', async () => {
    const table = find(view, '<m-table>');
    const { after } = await run({
      edits: [
        { insert_after: table.id, markdown: 'A new neighbouring paragraph.' },
      ],
    });
    const i = after.blocks.findIndex((b) => b.id === table.id);
    expect(after.blocks[i]).toEqual(table);
    expect(after.blocks[i + 1].markdown).toBe('A new neighbouring paragraph.');
  });

  it('deleting a plain block removes it', async () => {
    const quote = find(view, '> A quoted');
    const { after } = await run({ edits: [{ delete: quote.id }] });
    expect(after.blocks.length).toBe(18);
    expect(after.blocks.some((b) => b.id === quote.id)).toBe(false);
  });

  it('deleting a block with a comment needs allow_deleting_content', async () => {
    const list = find(view, '- Tomatoes');
    expect((await refusal([{ delete: list.id }])).code).toBe('comment_loss');
    const { after } = await run({
      edits: [{ delete: list.id }],
      allowDeletingContent: true,
    });
    expect(after.blocks.some((b) => b.id === list.id)).toBe(false);
  });

  it('the opaque block can move, cannot be edited, and needs allow_deleting_content to go', async () => {
    const opaque = view.blocks.find((b) => b.opaque);
    const closing = find(view, 'Closing paragraph');
    const moved = await run({
      edits: [{ move: opaque.id, after: closing.id }],
    });
    expect(moved.after.blocks.at(-1).id).toBe(opaque.id);
    expect(moved.after.blocks.at(-1).opaque).toBe(true);
    expect(moved.after.blocks.at(-1).nodeIds).toEqual(opaque.nodeIds);

    expect(
      (
        await refusal([
          { block_id: opaque.id, old: `<!-- keep:${opaque.id} -->`, new: 'x' },
        ])
      ).code
    ).toBe('opaque_edit');
    expect((await refusal([{ delete: opaque.id }])).code).toBe('opaque_edit');
    const deleted = await run({
      edits: [{ delete: opaque.id }],
      allowDeletingContent: true,
    });
    expect(deleted.after.blocks.some((b) => b.id === opaque.id)).toBe(false);
  });
});

describe('refusals leave the document untouched', () => {
  it('no_match suggests the nearest blocks', async () => {
    const error = await refusal([
      { old: 'Closing paragraph with a last note', new: 'x' },
    ]);
    expect(error.code).toBe('no_match');
    expect(error.edit).toBe(1);
    expect(error.blocks[0]).toEqual({
      blockId: find(view, 'Closing paragraph').id,
      occurrences: 0,
      markdown: 'Closing paragraph with a final note.',
    });
  });

  it('ambiguous_match lists every block it occurs in', async () => {
    const error = await refusal([
      { old: 'Tomatoes', new: 'x' },
      { old: 'bed', new: 'plot' },
    ]);
    expect(error.code).toBe('ambiguous_match');
    expect(error.edit).toBe(2);
    expect(error.blocks.length).toBeGreaterThan(1);
    expect(
      error.blocks.reduce((sum, block) => sum + block.occurrences, 0)
    ).toBeGreaterThan(1);
  });

  it('unknown_block for an id not in the document', async () => {
    expect((await refusal([{ delete: 'nope' }])).code).toBe('unknown_block');
    expect(
      (await refusal([{ insert_after: 'nope', markdown: 'x' }])).code
    ).toBe('unknown_block');
  });

  it('a later failing edit refuses the whole batch', async () => {
    const error = await refusal([
      { old: 'Closing paragraph', new: 'Last paragraph' },
      { old: 'Cucumbers', new: 'y' },
    ]);
    expect(error.code).toBe('no_match');
    expect(error.edit).toBe(2);
  });

  it('markup_leak for a placeholder typed into text', async () => {
    expect(
      (
        await refusal([
          {
            old: 'Closing paragraph',
            new: 'Closing <!-- keep:abc --> paragraph',
          },
        ])
      ).code
    ).toBe('markup_leak');
  });

  it('unparseable for malformed mention JSON', async () => {
    expect(
      (
        await refusal([
          {
            insert_after: 'end',
            markdown: 'Hi <m-user-mention>{"userId":}</m-user-mention>',
          },
        ])
      ).code
    ).toBe('unparseable');
  });

  it('mass_delete for most of the document', async () => {
    const deletes = view.blocks
      .filter((b) => !b.commentIds.length && !b.opaque)
      .slice(0, 12)
      .map((b) => ({ delete: b.id }));
    expect((await refusal(deletes)).code).toBe('mass_delete');
  });

  it('empty_edit for an empty old or insert', async () => {
    expect((await refusal([{ old: '', new: 'x' }])).code).toBe('empty_edit');
    expect(
      (await refusal([{ insert_after: 'end', markdown: '  ' }])).code
    ).toBe('empty_edit');
  });
});

describe('dry run and commits', () => {
  it('a dry run returns the changes and writes nothing', async () => {
    const closing = find(view, 'Closing paragraph');
    const { response, synced } = await run({
      edits: [{ old: 'Closing paragraph', new: 'Last paragraph' }],
      dryRun: true,
    });
    expect(synced.commits).toBe(0);
    expect(response).toEqual({
      outcome: 'dry_run',
      revision: synced.revision(),
      merge: 'current',
      changes: [
        {
          kind: 'edited',
          blockId: closing.id,
          before: 'Closing paragraph with a final note.',
          after: 'Last paragraph with a final note.',
        },
      ],
    });
  });

  it('a no-op batch writes nothing', async () => {
    const { response, synced } = await run({
      edits: [{ old: 'Closing paragraph', new: 'Closing paragraph' }],
    });
    expect(response.outcome).toBe('unchanged');
    expect(synced.commits).toBe(0);
  });

  it('a commit is one change by one AI peer', async () => {
    const synced = new SyncedDocument(base);
    const before = synced.doc.oplogVersion();
    await runDirectEdit(
      DOC,
      {
        edits: [
          { insert_before: 'start', markdown: '# New top' },
          { old: 'Closing paragraph', new: 'Last paragraph' },
        ],
      },
      synced,
      signal(),
      NOOP_SPAN
    );
    const update = synced.doc.export({ mode: 'update', from: before });
    const meta = decodeImportBlobMeta(update, false);
    expect(meta.changeNum).toBe(1);
    const peers = [...synced.doc.oplogVersion().toJSON().keys()].filter(
      (peer) => !before.toJSON().has(peer)
    );
    expect(peers.length).toBe(1);
    expect(isAiPeer(BigInt(peers[0]))).toBe(true);
  });
});

describe('embedded images', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('read as a short placeholder; an alt edit keeps the bytes; a changed placeholder is refused', async () => {
    const snapshot = await buildSnapshot(
      `# Pics\n\n![a dot](${PNG})\n\nAfter.`
    );
    const read = await readMarkdownBlocks(
      DOC,
      new SyncedDocument(snapshot),
      signal()
    );
    const image = read.blocks[1];
    expect(image.markdown).toMatch(
      /^!\[a dot\]\(data:redacted,[0-9a-f]{16}\)$/
    );

    const synced = new SyncedDocument(snapshot);
    await runDirectEdit(
      DOC,
      { edits: [{ block_id: image.id, old: 'a dot', new: 'one dot' }] },
      synced,
      signal(),
      NOOP_SPAN
    );
    const after = await readDocument(DOC, synced.snapshot());
    expect(after.blocks[1].markdown).toBe(`![one dot](${PNG})`);

    const error = await runDirectEdit(
      DOC,
      {
        edits: [
          { block_id: image.id, old: 'data:redacted,', new: 'data:redacted,0' },
        ],
      },
      new SyncedDocument(snapshot),
      signal(),
      NOOP_SPAN
    ).catch((e: unknown) => e);
    expect((error as EditRefusal).code).toBe('frozen_media');
  });
});

describe('review regressions', () => {
  it('bolding exactly the commented word keeps its comment', async () => {
    const snapshot = await buildSnapshot('Hello world', [
      { text: 'world', id: 'c1' },
    ]);
    const synced = new SyncedDocument(snapshot);
    await runDirectEdit(
      DOC,
      { edits: [{ old: 'world', new: '**world**' }] },
      synced,
      signal(),
      NOOP_SPAN
    );
    const after = await readDocument(DOC, synced.snapshot());
    expect(after.blocks[0].markdown).toBe('Hello **world**');
    expect(after.blocks[0].commentIds).toEqual(['c1']);
  });

  it('an edit that would drop a comment from a kept block is refused comment_loss', async () => {
    const snapshot = await buildSnapshot('Hello world', [
      { text: 'world', id: 'c1' },
    ]);
    for (const edit of [
      { old: 'Hello world', new: '# Hello world' },
      { old: ' world', new: '' },
    ]) {
      const synced = new SyncedDocument(snapshot);
      const error = await runDirectEdit(
        DOC,
        { edits: [edit] },
        synced,
        signal(),
        NOOP_SPAN
      ).catch((e: unknown) => e);
      expect((error as EditRefusal).code).toBe('comment_loss');
      expect(synced.commits).toBe(0);
    }
    const allowed = new SyncedDocument(snapshot);
    await runDirectEdit(
      DOC,
      {
        edits: [{ old: 'Hello world', new: '# Hello world' }],
        allowDeletingContent: true,
      },
      allowed,
      signal(),
      NOOP_SPAN
    );
    expect(allowed.commits).toBe(1);
  });

  it('an old text that starts or ends in a block separator joins the blocks', async () => {
    const snapshot = await buildSnapshot('A\n\nB');
    const cases: [old: string, replacement: string, expected: string[]][] = [
      ['\n\nB', 'X', ['AX']],
      ['A\n\n', 'X', ['XB']],
      ['\n\n', 'XYZ', ['AXYZB']],
      ['\n\n', '', ['AB']],
    ];
    for (const [old, replacement, expected] of cases) {
      const synced = new SyncedDocument(snapshot);
      await runDirectEdit(
        DOC,
        { edits: [{ old, new: replacement }] },
        synced,
        signal(),
        NOOP_SPAN
      );
      const after = await readDocument(DOC, synced.snapshot());
      expect(after.blocks.map((b) => b.markdown)).toEqual(expected);
    }
  });

  it('repeating a committed request with the same base writes nothing again', async () => {
    const snapshot = await buildSnapshot('Hello');
    const synced = new SyncedDocument(snapshot);
    const request = {
      baseRevision: synced.revision(),
      edits: [{ insert_after: 'end', markdown: 'Added' }],
    };

    const first = await runDirectEdit(
      DOC,
      request,
      synced,
      signal(),
      NOOP_SPAN
    );
    const retry = await runDirectEdit(
      DOC,
      request,
      synced,
      signal(),
      NOOP_SPAN
    );

    expect(first.outcome).toBe('committed');
    expect(retry).toEqual({
      outcome: 'already_applied',
      revision: synced.revision(),
      changes: [],
    });
    expect(synced.commits).toBe(1);
    const after = await readDocument(DOC, synced.snapshot());
    expect(after.blocks.map((b) => b.markdown)).toEqual(['Hello', 'Added']);
  });

  it('a retry after a lost acknowledgement is recognised too', async () => {
    const snapshot = await buildSnapshot('Hello');
    const synced = new SyncedDocument(snapshot);
    const request = {
      baseRevision: synced.revision(),
      edits: [{ insert_after: 'end', markdown: 'Added' }],
    };
    const lost = {
      load: () => synced.load(),
      commit: async (revision: string, update: Uint8Array) => {
        await synced.commit(revision, update);
        throw new Error('connection reset');
      },
    };

    await expect(
      runDirectEdit(DOC, request, lost, signal(), NOOP_SPAN)
    ).rejects.toThrow('connection reset');
    const retry = await runDirectEdit(
      DOC,
      request,
      synced,
      signal(),
      NOOP_SPAN
    );

    expect(retry.outcome).toBe('already_applied');
    const after = await readDocument(DOC, synced.snapshot());
    expect(after.blocks.map((b) => b.markdown)).toEqual(['Hello', 'Added']);
  });
});

describe('second review', () => {
  it('an old that occurs in a block and across blocks is ambiguous', async () => {
    const synced = new SyncedDocument(
      await buildSnapshot('One\n\nTwo\n\n```\nOne\n\nTwo\n```')
    );
    const error = await runDirectEdit(
      DOC,
      { edits: [{ old: 'One\n\nTwo', new: 'Joined' }] },
      synced,
      signal(),
      NOOP_SPAN
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EditRefusal);
    expect((error as EditRefusal).code).toBe('ambiguous_match');
    expect(synced.commits).toBe(0);
  });

  it('a base revision that is not a revision is a bad request', async () => {
    const error = await runDirectEdit(
      DOC,
      {
        edits: [{ insert_after: 'end', markdown: 'x' }],
        baseRevision: '%%%',
      },
      new SyncedDocument(base),
      signal(),
      NOOP_SPAN
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidBaseRevision);
  });

  it('an update sync-service already had is already applied', async () => {
    const synced = new SyncedDocument(base);
    synced.commit = async (_revision: string, update: Uint8Array) => {
      synced.doc.import(update);
      return { revision: synced.revision(), applied: false };
    };

    const { response } = await run(
      { edits: [{ insert_after: 'end', markdown: 'Added' }] },
      synced
    );

    expect(response).toEqual({
      outcome: 'already_applied',
      revision: synced.revision(),
      changes: [],
    });
  });

  it('a positional id is a conflict once blocks were added or removed', async () => {
    const shifted: DocumentView = {
      ...view,
      blocks: view.blocks.slice(1),
    };
    const edits: DirectEdit[] = [{ delete: 'index-3' }];

    expect(() => checkPositionalIds(edits, view, view)).not.toThrow();
    expect(() => checkPositionalIds(edits, view, shifted)).toThrow(
      DirectEditConflict
    );
    expect(() =>
      checkPositionalIds([{ delete: view.blocks[0].id }], view, shifted)
    ).not.toThrow();
  });

  it('a positional id is a conflict once the block at that position changed', () => {
    const positional = (v: DocumentView): DocumentView => ({
      ...v,
      blocks: v.blocks.map((block, i) => ({ ...block, id: `index-${i}` })),
    });
    const base = positional(view);
    const reordered = positional({
      ...view,
      blocks: [
        view.blocks[0],
        view.blocks[2],
        view.blocks[1],
        ...view.blocks.slice(3),
      ],
    });

    expect(() =>
      checkPositionalIds([{ delete: 'index-1' }], base, reordered)
    ).toThrow(DirectEditConflict);
    expect(() =>
      checkPositionalIds([{ delete: 'index-0' }], base, reordered)
    ).not.toThrow();
  });

  it('only refusals a concurrent change can cause become conflicts', () => {
    expect(asConflict(new EditRefusal('no_match', 'gone', 1))).toBeInstanceOf(
      DirectEditConflict
    );
    for (const code of ['verify_failed', 'too_large'] as const)
      expect(asConflict(new EditRefusal(code, 'engine'))).toBeInstanceOf(
        EditRefusal
      );
  });

  it('a match starting inside a separator takes the block before it', async () => {
    const synced = new SyncedDocument(await buildSnapshot('A\n\nBeta'));
    const { after } = await run(
      { edits: [{ old: '\nBeta', new: '\nGamma' }] },
      synced
    );
    expect(after.blocks.map((b) => b.markdown)).toEqual(['A', 'Gamma']);
  });

  it('text inserted before a commented word stays out of the comment', async () => {
    const synced = new SyncedDocument(
      await buildSnapshot('The cat sat.', [{ text: 'cat', id: 'cm-cat' }])
    );
    const { after } = await run(
      { edits: [{ old: 'The cat', new: 'The big cat' }] },
      synced
    );
    const marks: string[] = [];
    const walkMarks = (node: { type: string; children?: unknown[] }) => {
      if (node.type === 'comment-mark')
        marks.push(
          (node.children as { text?: string }[]).map((c) => c.text).join('')
        );
      for (const child of node.children ?? [])
        walkMarks(child as { type: string; children?: unknown[] });
    };
    for (const node of after.nodes) walkMarks(node);
    expect(after.blocks[0].markdown).toBe('The big cat sat.');
    expect(marks).toEqual(['cat']);
  });

  it('a replace_all batch that would grow past the limit is too large', async () => {
    const error = await runDirectEdit(
      DOC,
      {
        edits: Array.from({ length: 40 }, () => ({
          old: 'A',
          new: 'AA',
          replace_all: true,
        })),
      },
      new SyncedDocument(await buildSnapshot('A')),
      signal(),
      NOOP_SPAN
    ).catch((e: unknown) => e);
    expect((error as EditRefusal).code).toBe('too_large');
  });

  it('a percent-encoded data URI parameter is redacted', async () => {
    const uri = 'data:image/png;name=a%20b;base64,iVBORw0KGgo=';
    const synced = new SyncedDocument(
      await buildSnapshot(`Before.\n\n![pic](${uri})`)
    );
    const read = await readMarkdownBlocks(DOC, synced, signal());
    expect(read.blocks.map((b) => b.markdown).join('\n')).not.toContain(
      'iVBOR'
    );
  });

  it('changing an uploaded video link is refused; deleting the video is not', async () => {
    const video =
      '<m-video>{"url":"https://static.example.com/v.mp4","srcType":"dss","id":"vid-1","width":640,"height":360,"scale":1,"controls":true}</m-video>';
    const markdown = `Intro.\n\n${video}\n\n[link](https://static.example.com/v.mp4)`;
    const snapshot = await buildSnapshot(markdown);
    const read = await readDocument(DOC, snapshot);
    const block = read.blocks.find((b) => b.markdown.includes('m-video'));

    const changed = await runDirectEdit(
      DOC,
      { edits: [{ old: 'v.mp4","srcType', new: 'w.mp4","srcType' }] },
      new SyncedDocument(snapshot),
      signal(),
      NOOP_SPAN
    ).catch((e: unknown) => e);
    const { response } = await run(
      { edits: [{ delete: block.id }], allowDeletingContent: true },
      new SyncedDocument(snapshot)
    );

    expect((changed as EditRefusal).code).toBe('frozen_media');
    expect(response.outcome).toBe('committed');
  });

  it('moving the first of many blocks to the end reports one move', async () => {
    const markdown = Array.from({ length: 2100 }, (_, i) => `P${i}`).join(
      '\n\n'
    );
    const synced = new SyncedDocument(await buildSnapshot(markdown));
    const read = await readDocument(DOC, synced.snapshot());
    const { response } = await run(
      { edits: [{ move: read.blocks[0].id, after: 'end' }] },
      synced
    );
    expect(response.changes.filter((c) => c.kind === 'moved')).toHaveLength(1);
  }, 60_000);

  it('replacing text before an opaque block, separator kept, leaves the block alone', async () => {
    const snapshot = await buildSnapshot('Tail\n\nA private bit.', [
      { text: 'private', id: 'hl-1', plain: true },
    ]);
    const opaque = (await readDocument(DOC, snapshot)).blocks[1];
    const { response, after } = await run(
      { edits: [{ old: 'Tail\n\n', new: 'Done\n\n' }] },
      new SyncedDocument(snapshot)
    );
    expect(opaque.opaque).toBe(true);
    expect(response.outcome).toBe('committed');
    expect(after.blocks.map((b) => b.id)).toContain(opaque.id);
    expect(after.blocks[0].markdown).toBe('Done');
  });

  it('prose that reads like a placeholder is not refused', async () => {
    const synced = new SyncedDocument(
      await buildSnapshot('Before: data:redacted,example')
    );
    const { response } = await run(
      { edits: [{ old: 'Before', new: 'After' }] },
      synced
    );
    expect(response.outcome).toBe('committed');
  });

  it('a new bold run after a commented word stays out of the comment', async () => {
    const synced = new SyncedDocument(
      await buildSnapshot('Say word here.', [{ text: 'word', id: 'cm-word' }])
    );
    const { after } = await run(
      { edits: [{ old: 'word here', new: 'word**new** here' }] },
      synced
    );
    const marks: string[] = [];
    const walkMarks = (node: { type: string; children?: unknown[] }) => {
      if (node.type === 'comment-mark')
        marks.push(
          (node.children as { text?: string }[]).map((c) => c.text).join('')
        );
      for (const child of node.children ?? [])
        walkMarks(child as { type: string; children?: unknown[] });
    };
    for (const node of after.nodes) walkMarks(node);
    expect(after.blocks[0].markdown).toBe('Say word**new** here.');
    expect(marks).toEqual(['word']);
  });
});
