import { describe, expect, it } from 'vitest';
import type { DocReader, Match } from '../doc/interfaces';
import type { DocumentOp } from '../editor/ops';
import { mockRandomSource, type RandomSource } from './random-source';
import { DEFAULT_RANGES, type DocumentOpStep } from './types';
import { animate } from './animators';

/** Mock reader: canned answers, no Lexical. */
function reader(over: Partial<DocReader> = {}): DocReader {
  return {
    locate: () => [],
    textLength: () => 0,
    cellNode: () => 'cell',
    ...over,
  };
}

/** Run a single op through the animator and return its steps. */
function run(op: DocumentOp, opts: { randomSource?: RandomSource; docReader?: DocReader } = {}) {
  // pin speed 400 wpm → msPerChar 30 for exact-ms assertions
  const msPerChar = 60_000 / (400 * 5);
  const steps = animate(op, { randomSource: opts.randomSource ?? mockRandomSource(), docReader: opts.docReader ?? reader(), msPerChar, ranges: DEFAULT_RANGES });
  return { done: true, steps };
}

const onlyEdits = (steps: DocumentOpStep[]) => steps.filter((s) => s.kind === 'edit').map((s) => (s as any).y);
const highlights = (steps: DocumentOpStep[]) => steps.filter((s) => s.kind === 'awareness' && (s.x as any).type === 'highlight') as Array<{ kind: 'awareness'; x: { type: 'highlight'; node: string; span: { start: number; end: number } } }>;
const cursors = (steps: DocumentOpStep[]) => steps.filter((s) => s.kind === 'awareness' && (s.x as any).type === 'cursor') as Array<{ kind: 'awareness'; x: { type: 'cursor'; node: string; at: number } }>;
const pauses = (steps: DocumentOpStep[]) => steps.filter((s) => s.kind === 'pause').map((s) => (s as any).ms as number);

describe('formatText animator — full flow', () => {
  it('sweeps the matched span (3 sweeps, left-anchored) then one match-based edit', () => {
    // integer draws: preSelect(30), sweepCount=3, then 3 sweep pauses (75), then settle (145).
    const action = run(
      { kind: 'formatText', id: 'b5', match: 'Bluejay', format: 'bold', on: true, scope: { all: true } },
      { randomSource: mockRandomSource({ integer: [30, 3, 75, 75, 75, 145] }), docReader: reader({ locate: () => [{ node: 't1', start: 4, end: 11 }] }) }
    );
    expect(action.done).toBe(true);
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'awareness', x: { type: 'cursor', node: 't1', at: 11 } },
      { kind: 'pause', ms: 30 }, // preSelect rest on anchor
      { kind: 'awareness', x: { type: 'highlight', node: 't1', span: { start: 9, end: 11 } } },
      { kind: 'pause', ms: 75 },
      { kind: 'awareness', x: { type: 'highlight', node: 't1', span: { start: 7, end: 11 } } },
      { kind: 'pause', ms: 75 },
      { kind: 'awareness', x: { type: 'highlight', node: 't1', span: { start: 6, end: 11 } } },
      { kind: 'pause', ms: 75 },
      { kind: 'awareness', x: { type: 'highlight', node: 't1', span: { start: 4, end: 11 } } },
      { kind: 'pause', ms: 145 },
      { kind: 'edit', y: { fn: 'formatText', node: 'b5', match: 'Bluejay', format: 'bold', on: true, scope: { all: true } } },
    ]);
  });

  it('right-anchors the sweep when direction=right', () => {
    const action = run(
      { kind: 'formatText', id: 'b5', match: 'x', format: 'italic', on: true, scope: { all: true } },
      { randomSource: mockRandomSource({ direction: 'right', integer: [30, 3, 75, 75, 75, 145] }), docReader: reader({ locate: () => [{ node: 't1', start: 4, end: 11 }] }) }
    );
    // first awareness is a cursor at the START (right-anchored), grows rightward
    expect(action.steps[0]).toEqual({ kind: 'awareness', x: { type: 'cursor', node: 't1', at: 4 } });
    expect(action.steps[1]).toEqual({ kind: 'pause', ms: 30 }); // preSelect rest on anchor
    expect(action.steps[2]).toEqual({ kind: 'awareness', x: { type: 'highlight', node: 't1', span: { start: 4, end: 6 } } });
  });

  it('animates each occurrence with a pause between, then ONE edit covers all', () => {
    const matches: Match[] = [
      { node: 't1', start: 0, end: 4 },
      { node: 't2', start: 2, end: 6 },
    ];
    const action = run(
      { kind: 'formatText', id: 'b5', match: 'frog', format: 'bold', on: true, scope: { all: true } },
      { docReader: reader({ locate: () => matches }) }
    );
    // two selection groups, exactly one edit
    expect(onlyEdits(action.steps)).toHaveLength(1);
    expect(action.steps.some((s) => s.kind === 'awareness' && (s.x as any).node === 't2')).toBe(true);
  });
});

describe('highlight sweep count honors ranges (0–5)', () => {
  it('0 sweeps → a single (final) highlight', () => {
    const action = run(
      { kind: 'formatText', id: 'b5', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 0, 90] }), docReader: reader({ locate: () => [{ node: 't1', start: 0, end: 3 }] }) }
    );
    expect(highlights(action.steps)).toHaveLength(1);
  });
  it('5 sweeps → six highlights (5 incremental + final)', () => {
    const action = run(
      { kind: 'formatText', id: 'b5', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 5, 50, 50, 50, 50, 50, 90] }), docReader: reader({ locate: () => [{ node: 't1', start: 0, end: 10 }] }) }
    );
    expect(highlights(action.steps)).toHaveLength(6);
  });
});

describe('setText animator — select-all, delete, type (full flow)', () => {
  it('selects the existing text, deletes it, then types in 3-char chunks', () => {
    // integer draws: preSelect(30), sweepCount=3, 3 sweep pauses(75), settle(145), preDelete(190), typeText lead-in settle(150).
    // real draws: typeJitter 1.05; chunk len 2 → round(30*2*1.05)=63.
    const action = run(
      { kind: 'setText', id: 'b1', text: 'Hi' },
      { randomSource: mockRandomSource({ integer: [30, 3, 75, 75, 75, 145, 190, 150], real: 1.05 }), docReader: reader({ textLength: () => 5 }) }
    );
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'awareness', x: { type: 'cursor', node: 'b1', at: 5 } },
      { kind: 'pause', ms: 30 }, // preSelect rest on anchor
      { kind: 'awareness', x: { type: 'highlight', node: 'b1', span: { start: 4, end: 5 } } },
      { kind: 'pause', ms: 75 },
      { kind: 'awareness', x: { type: 'highlight', node: 'b1', span: { start: 2, end: 5 } } },
      { kind: 'pause', ms: 75 },
      { kind: 'awareness', x: { type: 'highlight', node: 'b1', span: { start: 1, end: 5 } } },
      { kind: 'pause', ms: 75 },
      { kind: 'awareness', x: { type: 'highlight', node: 'b1', span: { start: 0, end: 5 } } },
      { kind: 'pause', ms: 145 },
      { kind: 'pause', ms: 190 }, // preDelete
      { kind: 'edit', y: { fn: 'removeText', node: 'b1', at: 0, len: 5 } },
      { kind: 'awareness', x: { type: 'cursor', node: 'b1', at: 0 } },
      { kind: 'pause', ms: 150 }, // typeText lead-in
      { kind: 'edit', y: { fn: 'insertText', node: 'b1', at: 0, text: 'Hi' } },
      { kind: 'awareness', x: { type: 'cursor', node: 'b1', at: 2 } },
      { kind: 'pause', ms: 63 },
    ]);
  });

  it('skips the delete when the block is empty', () => {
    const action = run({ kind: 'setText', id: 'b1', text: 'A' }, { docReader: reader({ textLength: () => 0 }) });
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'insertText', node: 'b1', at: 0, text: 'A' }]);
  });
});

describe('append / prepend animators', () => {
  it('appendText puts the cursor at the end and types from there', () => {
    const action = run(
      { kind: 'appendText', id: 'b1', text: '!' },
      { randomSource: mockRandomSource({ real: 1.05 }), docReader: reader({ textLength: () => 5 }) }
    );
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'awareness', x: { type: 'cursor', node: 'b1', at: 5 } },
      { kind: 'pause', ms: 0 }, // typeText lead-in (default integer 0)
      { kind: 'edit', y: { fn: 'insertText', node: 'b1', at: 5, text: '!' } },
      { kind: 'awareness', x: { type: 'cursor', node: 'b1', at: 6 } },
      { kind: 'pause', ms: 32 },
    ]);
  });
  it('prependText types from offset 0', () => {
    const action = run({ kind: 'prependText', id: 'b1', text: 'AB' });
    expect(onlyEdits(action.steps)).toEqual([
      { fn: 'insertText', node: 'b1', at: 0, text: 'AB' },
    ]);
  });
});

describe('insertBlock animator', () => {
  it('inserts an EMPTY typed block, then types its text into the ref', () => {
    const action = run({ kind: 'insertBlock', ref: 'ref-1', spec: { block: 'paragraph', text: 'Hi' }, at: { after: 'b1' } });
    expect(action.steps[0]).toEqual({ kind: 'edit', y: { fn: 'insertNode', ref: 'ref-1', spec: { block: 'paragraph', text: '' }, at: { after: 'b1' } } });
    expect(onlyEdits(action.steps)).toEqual([
      { fn: 'insertNode', ref: 'ref-1', spec: { block: 'paragraph', text: '' }, at: { after: 'b1' } },
      { fn: 'insertText', node: 'ref-1', at: 0, text: 'Hi' },
    ]);
  });
  it('atomic block (image): caret to the insertion point, pause, it appears, caret moves in', () => {
    const action = run(
      { kind: 'insertBlock', ref: 'ref-2', spec: { block: 'image', srcType: 'url', url: 'http://i' }, at: { after: 'b1' } },
      { randomSource: mockRandomSource({ integer: 145 }), docReader: reader({ textLength: () => 4 }) }
    );
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'awareness', x: { type: 'cursor', node: 'b1', at: 4 } }, // caret at end of anchor
      { kind: 'pause', ms: 145 },
      { kind: 'edit', y: { fn: 'insertNode', ref: 'ref-2', spec: { block: 'image', srcType: 'url', url: 'http://i' }, at: { after: 'b1' } } },
      { kind: 'awareness', x: { type: 'cursor', node: 'ref-2', at: 0 } },
    ]);
  });

  it('divider: drafts the dashes, then swaps them for the rule', () => {
    const action = run({ kind: 'insertBlock', ref: 'ref-3', spec: { block: 'divider' }, at: { after: 'b1' } });
    expect(onlyEdits(action.steps)).toEqual([
      { fn: 'insertNode', ref: 'ref-3~draft', spec: { block: 'paragraph', text: '' }, at: { after: 'b1' } },
      { fn: 'insertText', node: 'ref-3~draft', at: 0, text: '---' },
      { fn: 'removeNode', node: 'ref-3~draft' },
      { fn: 'insertNode', ref: 'ref-3', spec: { block: 'divider' }, at: { after: 'b1' } },
    ]);
    // the three dashes type as one chunk: caret starts at 0, jumps to 3
    const cursors = action.steps.filter((s) => s.kind === 'awareness' && (s as any).x.type === 'cursor').map((s) => (s as any).x.at);
    expect(cursors).toEqual([0, 3]);
  });
});

describe('insertInline animator', () => {
  it('caret to the offset, pause, the inline node appears', () => {
    const action = run({ kind: 'insertInline', ref: 'r1', id: 'b1', at: 3, spec: { inline: 'date', date: '2026-01-01' } }, { randomSource: mockRandomSource({ integer: 145 }) });
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'awareness', x: { type: 'cursor', node: 'b1', at: 3 } },
      { kind: 'pause', ms: 145 },
      { kind: 'edit', y: { fn: 'insertInline', ref: 'r1', node: 'b1', at: 3, spec: { inline: 'date', date: '2026-01-01' } } },
    ]);
  });
});

describe('default speed', () => {
  it('is 2x (800 wpm → ~15ms/char) at DEFAULT_QUEUE_PARAMS speed', () => {
    const msPerChar = 60_000 / (800 * 5); // 15
    const steps = animate(
      { kind: 'appendText', id: 'b1', text: 'x' },
      { randomSource: mockRandomSource({ real: 1.05 }), docReader: reader({ textLength: () => 0 }), msPerChar, ranges: DEFAULT_RANGES },
    );
    // first pause is the typeText lead-in (integer 0); the per-char pause is the last.
    const pause = steps.filter((s) => s.kind === 'pause').at(-1);
    expect(pause).toEqual({ kind: 'pause', ms: 16 }); // round(15 * 1.05)
  });
});

describe('setCell animator', () => {
  it('resolves the cell node and retypes it', () => {
    const action = run(
      { kind: 'setCell', table: 'tbl', row: 1, col: 0, content: 'Hi' },
      { docReader: reader({ cellNode: () => 'cellX', textLength: () => 3 }) }
    );
    expect(onlyEdits(action.steps)).toEqual([
      { fn: 'removeText', node: 'cellX', at: 0, len: 3 },
      { fn: 'insertText', node: 'cellX', at: 0, text: 'Hi' },
    ]);
  });

  it('filling a freshly-built (empty) cell just types — cursor walks, no delete', () => {
    // this is the table-fill path: empty grid inserted, then each cell typed.
    const action = run(
      { kind: 'setCell', table: 'tbl', row: 0, col: 0, content: 'Hi' },
      { docReader: reader({ cellNode: () => 'cellX', textLength: () => 0 }) }
    );
    expect(onlyEdits(action.steps)).toEqual([
      { fn: 'insertText', node: 'cellX', at: 0, text: 'Hi' },
    ]);
    // the cursor lands at the end of the typed chunk (offset 2)
    const cursors = action.steps.filter((s) => s.kind === 'awareness' && (s as any).x.type === 'cursor').map((s) => (s as any).x.at);
    expect(cursors).toContain(2);
  });
});

describe('structural animators — focus then a single edit', () => {
  it('setBlockType selects the line, then transforms it', () => {
    const action = run({ kind: 'setBlockType', id: 'b1', block: 'heading', level: 2 }, { docReader: reader({ textLength: () => 5 }) });
    expect(highlights(action.steps).length).toBeGreaterThan(0); // selected the line
    expect(action.steps.at(-1)).toEqual({ kind: 'edit', y: { fn: 'setBlockType', node: 'b1', block: 'heading', level: 2, language: undefined } });
  });
  it('removeBlock selects the whole block then removes it', () => {
    const action = run({ kind: 'removeBlock', id: 'b1' }, { docReader: reader({ textLength: () => 4 }) });
    const last = action.steps.at(-1);
    expect(last).toEqual({ kind: 'edit', y: { fn: 'removeNode', node: 'b1' } });
    expect(highlights(action.steps).length).toBeGreaterThan(0);
  });
  it('setListType focuses the first id and edits all', () => {
    expect(onlyEdits(run({ kind: 'setListType', ids: ['b1', 'b2'], list: 'bullet' }).steps)).toEqual([
      { fn: 'setListType', nodes: ['b1', 'b2'], list: 'bullet' },
    ]);
  });
});

describe('enriched structural animations', () => {
  it('moveBlock selects the whole block before moving', () => {
    const steps = run({ kind: 'moveBlock', id: 'b1', at: { before: 'b2' } }, { docReader: reader({ textLength: () => 6 }) }).steps;
    expect(highlights(steps).length).toBeGreaterThan(0);
    expect(steps.at(-1)).toEqual({ kind: 'edit', y: { fn: 'moveNode', node: 'b1', at: { before: 'b2' } } });
  });

  it('mergeBlocks highlights each block then merges', () => {
    const steps = run({ kind: 'mergeBlocks', ids: ['b1', 'b2'], separator: ' ' }, { docReader: reader({ textLength: () => 3 }) }).steps;
    // highlights touch both b1 and b2
    expect(steps.some((s) => s.kind === 'awareness' && (s.x as any).node === 'b1')).toBe(true);
    expect(steps.some((s) => s.kind === 'awareness' && (s.x as any).node === 'b2')).toBe(true);
    expect(onlyEdits(steps)).toEqual([{ fn: 'mergeBlocks', nodes: ['b1', 'b2'], separator: ' ' }]);
  });

  it('splitBlock puts the caret at the split point', () => {
    const steps = run({ kind: 'splitBlock', id: 'b1', atText: 'half' }, { docReader: reader({ locate: () => [{ node: 't9', start: 5, end: 9 }] }) }).steps;
    expect(steps[0]).toEqual({ kind: 'awareness', x: { type: 'cursor', node: 't9', at: 5 } });
    expect(steps.at(-1)).toEqual({ kind: 'edit', y: { fn: 'splitBlock', node: 'b1', atText: 'half' } });
  });

  it('clearFormat (whole block) selects all then clears', () => {
    const steps = run({ kind: 'clearFormat', id: 'b1', scope: { all: true } }, { docReader: reader({ textLength: () => 8 }) }).steps;
    expect(highlights(steps).length).toBeGreaterThan(0);
    expect(onlyEdits(steps)).toEqual([{ fn: 'clearFormat', node: 'b1', match: undefined, scope: { all: true } }]);
  });

  it('insertInline places the caret at the offset before inserting', () => {
    const steps = run({ kind: 'insertInline', ref: 'r1', id: 'b1', at: 3, spec: { inline: 'linebreak' } }).steps;
    expect(steps[0]).toEqual({ kind: 'awareness', x: { type: 'cursor', node: 'b1', at: 3 } });
    expect(onlyEdits(steps)).toEqual([{ fn: 'insertInline', ref: 'r1', node: 'b1', at: 3, spec: { inline: 'linebreak' } }]);
  });
});

describe('every op kind has an animation that ends in the right edit', () => {
  // one representative op per kind → (non-empty steps, terminal edit fn).
  const cases: Array<[DocumentOp, string]> = [
    [{ kind: 'formatText', id: 'b1', match: 'x', format: 'bold', on: true, scope: {} }, 'formatText'],
    [{ kind: 'clearFormat', id: 'b1', match: 'x', scope: {} }, 'clearFormat'],
    [{ kind: 'clearFormat', id: 'b1', scope: {} }, 'clearFormat'],
    [{ kind: 'formatNode', textId: 't1', format: 'italic', on: true }, 'formatNode'],
    [{ kind: 'clearNodeFormat', textId: 't1' }, 'clearNodeFormat'],
    [{ kind: 'markText', id: 'b1', match: 'x', on: true, scope: {} }, 'markText'],
    [{ kind: 'linkText', id: 'b1', match: 'x', url: 'u', scope: {} }, 'linkText'],
    [{ kind: 'setText', id: 'b1', text: 'a' }, 'insertText'],
    [{ kind: 'replaceText', id: 'b1', find: 'a', to: 'b', scope: {} }, 'replaceText'],
    [{ kind: 'appendText', id: 'b1', text: 'a' }, 'insertText'],
    [{ kind: 'prependText', id: 'b1', text: 'a' }, 'insertText'],
    [{ kind: 'setBlockType', id: 'b1', block: 'heading', level: 1 }, 'setBlockType'],
    [{ kind: 'setListType', ids: ['b1'], list: 'bullet' }, 'setListType'],
    [{ kind: 'setChecked', id: 'b1', checked: true }, 'setChecked'],
    [{ kind: 'setIndent', id: 'b1', indent: 'in' }, 'setIndent'],
    [{ kind: 'sortList', id: 'b1', order: 'asc' }, 'sortList'],
    [{ kind: 'insertBlock', ref: 'r1', spec: { block: 'divider' }, at: { after: 'b1' } }, 'insertNode'],
    [{ kind: 'insertInline', ref: 'r1', id: 'b1', at: 0, spec: { inline: 'linebreak' } }, 'insertInline'],
    [{ kind: 'moveBlock', id: 'b1', at: { before: 'b2' } }, 'moveNode'],
    [{ kind: 'removeBlock', id: 'b1' }, 'removeNode'],
    [{ kind: 'mergeBlocks', ids: ['b1', 'b2'], separator: ' ' }, 'mergeBlocks'],
    [{ kind: 'splitBlock', id: 'b1', atText: 'x' }, 'splitBlock'],
    [{ kind: 'setCell', table: 't', row: 0, col: 0, content: 'a' }, 'insertText'],
    [{ kind: 'addRow', table: 't' }, 'addRow'],
    [{ kind: 'addColumn', table: 't' }, 'addColumn'],
    [{ kind: 'removeRow', table: 't', row: 1 }, 'removeRow'],
    [{ kind: 'removeColumn', table: 't', col: 1 }, 'removeColumn'],
  ];

  it.each(cases)('%o animates and ends in an edit', (op, terminalFn) => {
    const docReader = reader({ locate: () => [{ node: 't1', start: 0, end: 1 }], textLength: () => 3, cellNode: () => 'cellX' });
    const steps = run(op, { docReader }).steps;
    expect(steps.length).toBeGreaterThan(0);
    const edits = onlyEdits(steps);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.at(-1)!.fn).toBe(terminalFn);
  });

  it('covers every DocumentOp kind', () => {
    const kinds = new Set(cases.map(([op]) => op.kind));
    const all = [
      'formatText', 'clearFormat', 'formatNode', 'clearNodeFormat', 'markText', 'linkText',
      'setText', 'replaceText', 'appendText', 'prependText', 'setBlockType', 'setListType',
      'setChecked', 'setIndent', 'sortList', 'insertBlock', 'insertInline', 'moveBlock',
      'removeBlock', 'mergeBlocks', 'splitBlock', 'setCell', 'addRow', 'addColumn', 'removeRow', 'removeColumn',
    ];
    for (const k of all) expect(kinds.has(k as DocumentOp['kind'])).toBe(true);
  });
});


// ── sweepSelect via formatText (the simplest animator that uses it on one match) ──

describe('sweepSelect — anchoring & grow offsets', () => {
  it('left-anchored: cursor at END, each highlight grows the left edge toward start', () => {
    // sweeps=3. len=10, start=0,end=10.
    // grow(i) = round(i/4 * 10): i=1→3 (round(2.5)=3), i=2→5, i=3→8 (round(7.5)=8)
    const action = run(
      { kind: 'formatText', id: 'b', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 3, 75, 75, 75, 145], direction: 'left' }), docReader: reader({ locate: () => [{ node: 't', start: 0, end: 10 }] }) }
    );
    const hl = highlights(action.steps);
    expect(cursors(action.steps)[0]!.x.at).toBe(10); // anchored at end
    expect(hl.map((h) => [h.x.span.start, h.x.span.end])).toEqual([
      [7, 10], // end - 3
      [5, 10], // end - 5
      [2, 10], // end - 8
      [0, 10], // final
    ]);
  });

  it('right-anchored: cursor at START, each highlight grows the right edge toward end', () => {
    const action = run(
      { kind: 'formatText', id: 'b', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 3, 75, 75, 75, 145], direction: 'right' }), docReader: reader({ locate: () => [{ node: 't', start: 0, end: 10 }] }) }
    );
    const hl = highlights(action.steps);
    expect(cursors(action.steps)[0]!.x.at).toBe(0); // anchored at start
    expect(hl.map((h) => [h.x.span.start, h.x.span.end])).toEqual([
      [0, 3],
      [0, 5],
      [0, 8],
      [0, 10], // final
    ]);
  });

  it('right-anchored with a non-zero start offsets grow from start', () => {
    // start=4,end=11 (len 7), sweeps=3. grow i=1→round(7/4)=2, i=2→round(14/4=3.5)=4, i=3→round(21/4=5.25)=5
    const action = run(
      { kind: 'formatText', id: 'b', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 3, 75, 75, 75, 145], direction: 'right' }), docReader: reader({ locate: () => [{ node: 't', start: 4, end: 11 }] }) }
    );
    const hl = highlights(action.steps);
    expect(hl.map((h) => [h.x.span.start, h.x.span.end])).toEqual([
      [4, 6],
      [4, 8],
      [4, 9],
      [4, 11], // final span = (start,end)
    ]);
  });

  it('sweeps=0 → exactly one final highlight, no incremental sweeps', () => {
    const action = run(
      { kind: 'formatText', id: 'b', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 0, 90], direction: 'left' }), docReader: reader({ locate: () => [{ node: 't', start: 2, end: 8 }] }) }
    );
    const hl = highlights(action.steps);
    expect(hl).toHaveLength(1);
    expect([hl[0]!.x.span.start, hl[0]!.x.span.end]).toEqual([2, 8]);
    // two pauses (preSelect + settle); sweepPause loop ran 0 times
    expect(pauses(action.steps)).toEqual([30, 90]);
  });

  it('sweeps=5 → six highlights with monotonically growing spans (left)', () => {
    // len=12, sweeps=5: grow i = round(i/6*12) = round(2i) = 2,4,6,8,10
    const action = run(
      { kind: 'formatText', id: 'b', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 5, 50, 50, 50, 50, 50, 90], direction: 'left' }), docReader: reader({ locate: () => [{ node: 't', start: 0, end: 12 }] }) }
    );
    const hl = highlights(action.steps);
    expect(hl).toHaveLength(6);
    expect(hl.map((h) => h.x.span.start)).toEqual([10, 8, 6, 4, 2, 0]);
    expect(hl.every((h) => h.x.span.end === 12)).toBe(true);
  });

  it('len=0 (degenerate, start===end): all sweeps collapse to a zero-width span', () => {
    const action = run(
      { kind: 'formatText', id: 'b', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 5, 50, 50, 50, 50, 50, 90], direction: 'left' }), docReader: reader({ locate: () => [{ node: 't', start: 5, end: 5 }] }) }
    );
    const hl = highlights(action.steps);
    expect(hl).toHaveLength(6);
    expect(hl.every((h) => h.x.span.start === 5 && h.x.span.end === 5)).toBe(true);
    expect(cursors(action.steps)[0]!.x.at).toBe(5);
  });
});

describe('sweepSelect — pause ms come straight from the integer draws', () => {
  it('0 sweeps → only the settle pause', () => {
    const action = run(
      { kind: 'formatText', id: 'b', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 0, 90] }), docReader: reader({ locate: () => [{ node: 't', start: 0, end: 4 }] }) }
    );
    expect(pauses(action.steps)).toEqual([30, 90]); // preSelect + settle
  });

  it('3 sweeps → 3 sweep pauses then the settle pause', () => {
    const action = run(
      { kind: 'formatText', id: 'b', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 3, 75, 75, 75, 145] }), docReader: reader({ locate: () => [{ node: 't', start: 0, end: 4 }] }) }
    );
    expect(pauses(action.steps)).toEqual([30, 75, 75, 75, 145]);
  });

  it('5 sweeps → 5 sweep pauses then the settle pause', () => {
    const action = run(
      { kind: 'formatText', id: 'b', match: 'x', format: 'bold', on: true, scope: {} },
      { randomSource: mockRandomSource({ integer: [30, 5, 109, 109, 109, 109, 109, 199] }), docReader: reader({ locate: () => [{ node: 't', start: 0, end: 4 }] }) }
    );
    expect(pauses(action.steps)).toEqual([30, 109, 109, 109, 109, 109, 199]);
  });
});

describe('typeText — per-char pause = round(msPerChar * typeJitter draw)', () => {
  it('pause = round(30 * real draw): real=0.6 → 18', () => {
    const action = run({ kind: 'appendText', id: 'b', text: 'a' }, { randomSource: mockRandomSource({ real: 0.6 }), docReader: reader({ textLength: () => 0 }) });
    expect(pauses(action.steps)).toEqual([0, 18]); // lead-in (integer 0) then per-char
  });
  it('pause = round(30 * real draw): real=1.5 → 45', () => {
    const action = run({ kind: 'appendText', id: 'b', text: 'a' }, { randomSource: mockRandomSource({ real: 1.5 }), docReader: reader({ textLength: () => 0 }) });
    expect(pauses(action.steps)).toEqual([0, 45]); // lead-in (integer 0) then per-char
  });

  it('chunk offset progression: insert/cursor/pause per 3-char chunk from the start offset', () => {
    // prependText types from offset 0; "abc" is one 3-char chunk → pause round(30*3*1.05)=95
    const action = run({ kind: 'prependText', id: 'b', text: 'abc' }, { randomSource: mockRandomSource({ real: 1.05 }) });
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'awareness', x: { type: 'cursor', node: 'b', at: 0 } },
      { kind: 'pause', ms: 0 }, // typeText lead-in (default integer 0)
      { kind: 'edit', y: { fn: 'insertText', node: 'b', at: 0, text: 'abc' } },
      { kind: 'awareness', x: { type: 'cursor', node: 'b', at: 3 } },
      { kind: 'pause', ms: 95 },
    ]);
  });

  it('appendText offsets start at the existing length', () => {
    const action = run({ kind: 'appendText', id: 'b', text: 'XY' }, { randomSource: mockRandomSource({ real: 1.05 }), docReader: reader({ textLength: () => 7 }) });
    expect(onlyEdits(action.steps)).toEqual([
      { fn: 'insertText', node: 'b', at: 7, text: 'XY' },
    ]);
    expect(cursors(action.steps).map((c) => c.x.at)).toEqual([7, 9]); // initial + after the chunk
  });

  it('empty append/prepend string → no edits and no type pauses', () => {
    const appendAction = run({ kind: 'appendText', id: 'b', text: '' }, { docReader: reader({ textLength: () => 3 }) });
    // appendText still emits the initial cursor, but no insert/pause
    expect(onlyEdits(appendAction.steps)).toEqual([]);
    expect(pauses(appendAction.steps)).toEqual([]);
    expect(cursors(appendAction.steps)).toHaveLength(1);

    const prependAction = run({ kind: 'prependText', id: 'b', text: '' });
    expect(onlyEdits(prependAction.steps)).toEqual([]);
    expect(pauses(prependAction.steps)).toEqual([]);
  });
});

describe('retype (setText) — delete branch and ordering', () => {
  it('non-empty target: selectAll → preDelete pause → removeText → cursor 0 → typeText', () => {
    // integer draws: preSelect=30, sweeps=0 (single highlight), settle=90, preDelete=120, typeText lead-in=150. real=0.6 → type pause 18.
    const action = run({ kind: 'setText', id: 'b', text: 'Z' }, { randomSource: mockRandomSource({ integer: [30, 0, 90, 120, 150], real: 0.6 }), docReader: reader({ textLength: () => 3 }) });
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'awareness', x: { type: 'cursor', node: 'b', at: 3 } }, // selectAll cursor (left-anchored at end)
      { kind: 'pause', ms: 30 }, // preSelect rest on anchor
      { kind: 'awareness', x: { type: 'highlight', node: 'b', span: { start: 0, end: 3 } } },
      { kind: 'pause', ms: 90 }, // settle
      { kind: 'pause', ms: 120 }, // preDelete
      { kind: 'edit', y: { fn: 'removeText', node: 'b', at: 0, len: 3 } },
      { kind: 'awareness', x: { type: 'cursor', node: 'b', at: 0 } },
      { kind: 'pause', ms: 150 }, // typeText lead-in
      { kind: 'edit', y: { fn: 'insertText', node: 'b', at: 0, text: 'Z' } },
      { kind: 'awareness', x: { type: 'cursor', node: 'b', at: 1 } },
      { kind: 'pause', ms: 18 }, // typeJitter real 0.6 → round(30*0.6)
    ]);
  });

  it('empty target (textLength 0): no preDelete pause, no removeText, no cursor-0 reset', () => {
    const action = run({ kind: 'setText', id: 'b', text: 'Hi' }, { randomSource: mockRandomSource({ integer: [30, 0, 90, 150], real: 0.6 }), docReader: reader({ textLength: () => 0 }) });
    // selectAll over a 0-length node still emits cursor + one final highlight + preSelect + settle pause
    expect(onlyEdits(action.steps)).toEqual([
      { fn: 'insertText', node: 'b', at: 0, text: 'Hi' },
    ]);
    // removeText must NOT appear (delete branch skipped for empty target)
    expect(action.steps.filter((s) => s.kind === 'edit' && (s as any).y.fn === 'removeText')).toHaveLength(0);
    // no preDelete pause — preSelect(30) + settle(90) + typeText lead-in(150) + 1 chunk pause round(30*2*0.6)=36
    expect(pauses(action.steps)).toEqual([30, 90, 150, 36]);
  });

  it('empty target with empty text → just selectAll, no edits at all', () => {
    const action = run({ kind: 'setText', id: 'b', text: '' }, { randomSource: mockRandomSource({ integer: [30, 0, 90] }), docReader: reader({ textLength: () => 0 }) });
    expect(onlyEdits(action.steps)).toEqual([]);
  });
});

describe('sweepEachThen — one selection group per match, betweenNodes pause, single edit', () => {
  it('zero matches → just the single edit, no selection steps', () => {
    const action = run(
      { kind: 'formatText', id: 'b', match: 'nope', format: 'bold', on: true, scope: {} },
      { docReader: reader({ locate: () => [] }) }
    );
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'edit', y: { fn: 'formatText', node: 'b', match: 'nope', format: 'bold', on: true, scope: {} } },
    ]);
  });

  it('three matches → a betweenNodes pause precedes the 2nd and 3rd group (not the 1st)', () => {
    const matches: Match[] = [
      { node: 't1', start: 0, end: 1 },
      { node: 't2', start: 0, end: 1 },
      { node: 't3', start: 0, end: 1 },
    ];
    // 0 sweeps per group; each group = cursor + preSelect pause + final highlight + settle(90).
    // integer draws per group: preSelect(30), sweeps(0), settle(90); betweenNodes(180) before groups 2 & 3.
    const action = run(
      { kind: 'markText', id: 'b', match: 'x', on: true, scope: { all: true } },
      { randomSource: mockRandomSource({ integer: [30, 0, 90, 180, 30, 0, 90, 180, 30, 0, 90], direction: 'left' }), docReader: reader({ locate: () => matches }) }
    );
    // betweenNodes pause (180) appears exactly twice
    expect(pauses(action.steps).filter((ms) => ms === 180)).toHaveLength(2);
    expect(highlights(action.steps).map((h) => h.x.node)).toEqual(['t1', 't2', 't3']);
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'markText', node: 'b', match: 'x', on: true, scope: { all: true } }]);
  });

  it('replaceText routes find as the match and carries to/scope into the edit', () => {
    const action = run(
      { kind: 'replaceText', id: 'b', find: 'cat', to: 'dog', scope: { nth: 1 } },
      { docReader: reader({ locate: () => [{ node: 't1', start: 0, end: 3 }] }) }
    );
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'replaceText', node: 'b', find: 'cat', to: 'dog', scope: { nth: 1 } }]);
  });

  it('linkText carries the url into the edit', () => {
    const action = run(
      { kind: 'linkText', id: 'b', match: 'here', url: 'http://x', scope: {} },
      { docReader: reader({ locate: () => [{ node: 't1', start: 0, end: 4 }] }) }
    );
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'linkText', node: 'b', match: 'here', url: 'http://x', scope: {} }]);
  });
});

describe('clearFormat animator — match vs whole-block branches', () => {
  it('with a match → sweepEachThen (per-occurrence selection)', () => {
    const action = run(
      { kind: 'clearFormat', id: 'b', match: 'x', scope: {} },
      { docReader: reader({ locate: () => [{ node: 't1', start: 0, end: 1 }] }) }
    );
    expect(highlights(action.steps).length).toBeGreaterThan(0);
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'clearFormat', node: 'b', match: 'x', scope: {} }]);
  });
  it('without a match → selectAll over the whole block then one clear', () => {
    const action = run(
      { kind: 'clearFormat', id: 'b', scope: { all: true } },
      { randomSource: mockRandomSource({ integer: [30, 0, 90] }), docReader: reader({ textLength: () => 6 }) }
    );
    const hl = highlights(action.steps);
    expect(hl).toHaveLength(1);
    expect([hl[0]!.x.span.start, hl[0]!.x.span.end]).toEqual([0, 6]);
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'clearFormat', node: 'b', match: undefined, scope: { all: true } }]);
  });
});

describe('formatNode / clearNodeFormat animators — sweep over textId length', () => {
  it('formatNode selects the whole text-node then formats', () => {
    const action = run(
      { kind: 'formatNode', textId: 't1', format: 'italic', on: true },
      { randomSource: mockRandomSource({ integer: [30, 0, 90] }), docReader: reader({ textLength: () => 4 }) }
    );
    const hl = highlights(action.steps);
    expect([hl[0]!.x.span.start, hl[0]!.x.span.end]).toEqual([0, 4]);
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'formatNode', node: 't1', format: 'italic', on: true }]);
  });
  it('clearNodeFormat selects the whole text-node then clears', () => {
    const action = run(
      { kind: 'clearNodeFormat', textId: 't1' },
      { randomSource: mockRandomSource({ integer: [30, 0, 90] }), docReader: reader({ textLength: () => 4 }) }
    );
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'clearNodeFormat', node: 't1' }]);
  });
});

describe('insertBlock animator — typed vs whole', () => {
  it('heading is a TYPED_BLOCK: inserted empty then typed', () => {
    const action = run({ kind: 'insertBlock', ref: 'r', spec: { block: 'heading', level: 2, text: 'Hi' }, at: { after: 'b1' } });
    expect(onlyEdits(action.steps)).toEqual([
      { fn: 'insertNode', ref: 'r', spec: { block: 'heading', level: 2, text: '' }, at: { after: 'b1' } },
      { fn: 'insertText', node: 'r', at: 0, text: 'Hi' },
    ]);
  });
  it('quote/code are TYPED_BLOCKS too', () => {
    const q = run({ kind: 'insertBlock', ref: 'r', spec: { block: 'quote', text: 'X' }, at: { appendToRoot: true } });
    expect(onlyEdits(q.steps).map((e: any) => e.fn)).toEqual(['insertNode', 'insertText']);
  });
  it('a typed block with empty text inserts empty and types nothing', () => {
    const action = run({ kind: 'insertBlock', ref: 'r', spec: { block: 'paragraph', text: '' }, at: { appendToRoot: true } });
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'insertNode', ref: 'r', spec: { block: 'paragraph', text: '' }, at: { appendToRoot: true } }]);
  });
  it('a typed block with NO text key inserts empty and types nothing', () => {
    const action = run({ kind: 'insertBlock', ref: 'r', spec: { block: 'paragraph' }, at: { appendToRoot: true } });
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'insertNode', ref: 'r', spec: { block: 'paragraph', text: '' }, at: { appendToRoot: true } }]);
  });
  it('list builds item by item: empty list, then append + type each item', () => {
    const action = run({ kind: 'insertBlock', ref: 'r', spec: { block: 'list', list: 'bullet', items: ['a', 'b'] }, at: { appendToRoot: true } });
    expect(onlyEdits(action.steps)).toEqual([
      { fn: 'insertNode', ref: 'r', spec: { block: 'list', list: 'bullet', items: [] }, at: { appendToRoot: true } },
      { fn: 'appendListItem', ref: 'r~li-0', node: 'r', checked: undefined },
      { fn: 'insertText', node: 'r~li-0', at: 0, text: 'a' },
      { fn: 'appendListItem', ref: 'r~li-1', node: 'r', checked: undefined },
      { fn: 'insertText', node: 'r~li-1', at: 0, text: 'b' },
    ]);
    // each item's caret drops into its own fresh node before typing
    expect(cursors(action.steps).map((c) => c.x.node)).toContain('r~li-0');
    expect(cursors(action.steps).map((c) => c.x.node)).toContain('r~li-1');
  });
  it('check list seeds each appended item as unchecked', () => {
    const action = run({ kind: 'insertBlock', ref: 'r', spec: { block: 'list', list: 'check', items: ['x'] }, at: { appendToRoot: true } });
    expect(onlyEdits(action.steps)).toContainEqual({ fn: 'appendListItem', ref: 'r~li-0', node: 'r', checked: false });
  });
});

describe('splitBlock animator — caret fallback', () => {
  it('falls back to focus(id) when atText is not located', () => {
    const action = run(
      { kind: 'splitBlock', id: 'b1', atText: 'gone' },
      { randomSource: mockRandomSource({ integer: [90] }), docReader: reader({ locate: () => [] }) }
    );
    // focus = cursor(0) + settle pause(90); then the edit
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'awareness', x: { type: 'cursor', node: 'b1', at: 0 } },
      { kind: 'pause', ms: 90 },
      { kind: 'edit', y: { fn: 'splitBlock', node: 'b1', atText: 'gone' } },
    ]);
  });
});

describe('mergeBlocks animator — between-node pauses', () => {
  it('three ids → two betweenNodes pauses and one merge edit', () => {
    const action = run(
      { kind: 'mergeBlocks', ids: ['b1', 'b2', 'b3'], separator: ' ' },
      { randomSource: mockRandomSource({ integer: [30, 0, 90, 180, 30, 0, 90, 180, 30, 0, 90] }), docReader: reader({ textLength: () => 2 }) }
    );
    expect(pauses(action.steps).filter((ms) => ms === 180)).toHaveLength(2);
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'mergeBlocks', nodes: ['b1', 'b2', 'b3'], separator: ' ' }]);
    expect(highlights(action.steps).map((h) => h.x.node)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('addRow/addColumn/removeRow/removeColumn — focus then table edit', () => {
  it('addRow at index', () => {
    const action = run({ kind: 'addRow', table: 't', at: 2 }, { randomSource: mockRandomSource({ integer: [90] }) });
    expect(action.steps).toEqual<DocumentOpStep[]>([
      { kind: 'awareness', x: { type: 'cursor', node: 't', at: 0 } },
      { kind: 'pause', ms: 90 },
      { kind: 'edit', y: { fn: 'addRow', table: 't', at: 2 } },
    ]);
  });
  it('removeColumn', () => {
    const action = run({ kind: 'removeColumn', table: 't', col: 1 });
    expect(onlyEdits(action.steps)).toEqual([{ fn: 'removeColumn', table: 't', col: 1 }]);
  });
});
