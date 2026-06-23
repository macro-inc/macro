import { describe, expect, it, vi } from 'vitest';
import type { DocReader, DocWriter } from '../doc/interfaces';
import type { DocumentOp } from '../editor/ops';
import { DEFAULT_QUEUE_PARAMS } from './types';
import { applyEdit, describe as describeOp, runQueue, summarize, type OpResult } from './runner';
import { mockRandomSource } from './random-source';
import type { Awareness, Edit } from './types';
import { recordingWriter, recordingAwareness } from './_testUtils';

const reader = (over: Partial<DocReader> = {}): DocReader => ({
  locate: () => [{ node: 't1', start: 0, end: 3 }],
  textLength: () => 4,
  cellNode: () => 'cell',
  ...over,
});

async function run(ops: DocumentOp[], writer: DocWriter, opts: { docReader?: DocReader; sleep?: (ms: number) => Promise<void> } = {}) {
  const awareness = recordingAwareness();
  const results = await runQueue({
    ops,
    params: DEFAULT_QUEUE_PARAMS,
    randomSource: mockRandomSource(),
    docReader: opts.docReader ?? reader(),
    docWriter: writer,
    awarenessSource: awareness.source,
    sleep: opts.sleep ?? (() => Promise.resolve()),
  });
  return { results, awareness };
}

describe('runQueue -- happy path', () => {
  it('applies edits in order and pumps awareness, returning one ok result per op', async () => {
    const { w, calls } = recordingWriter();
    const { results, awareness } = await run(
      [
        { kind: 'setBlockType', id: 'b1', block: 'heading', level: 2 },
        { kind: 'removeBlock', id: 'b2' },
      ],
      w
    );
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(calls.map((c) => c.fn)).toEqual(['setBlockType', 'removeNode']);
    expect(awareness.seen.length).toBeGreaterThan(0); // cursors/highlights were pumped
  });

  it('expands a setText op into remove + chunked insert edits', async () => {
    const { w, calls } = recordingWriter();
    // typeText emits TYPE_CHUNK (3) chars per keystroke, so "Hi" is one insert.
    await run([{ kind: 'setText', id: 'b1', text: 'Hi' }], w, { docReader: reader({ textLength: () => 4 }) });
    expect(calls.map((c) => c.fn)).toEqual(['removeText', 'insertText']);
    expect(calls[1]!.args).toEqual(['b1', 0, 'Hi']);
  });

  it('awaits pauses through the injected sleep', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await runQueue({
      ops: [{ kind: 'setBlockType', id: 'b1', block: 'quote' }], params: DEFAULT_QUEUE_PARAMS,
      randomSource: mockRandomSource(),
      docReader: reader(),
      docWriter: recordingWriter().w,
      awarenessSource: { apply: () => {} },
      sleep,
    });
    expect(sleep).toHaveBeenCalled();
  });
});

describe('runQueue -- error handling', () => {
  it('records a failed op but keeps applying independent ones', async () => {
    const { w } = recordingWriter({ fn: 'removeNode', error: 'boom' });
    const { results } = await run(
      [
        { kind: 'setBlockType', id: 'b1', block: 'quote' }, // ok
        { kind: 'removeBlock', id: 'b2' }, // throws
        { kind: 'setChecked', id: 'b3', checked: true }, // still runs
      ],
      w
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    const failed = results[1]!;
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toBe('boom');
  });

  it('attributes a planning-time read failure to the stepped op', async () => {
    const { w } = recordingWriter();
    const docReader = reader({
      textLength: () => {
        throw new Error('no node');
      },
    });
    // setText animator reads textLength during step → throws while planning
    const { results } = await run([{ kind: 'setText', id: 'ghost', text: 'x' }], w, { docReader });
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) expect(results[0].op.kind).toBe('setText');
  });

  it('returns no results for an empty queue', async () => {
    const { results } = await run([], recordingWriter().w);
    expect(results).toEqual([]);
  });
});

describe('applyEdit routing (unit)', () => {
  it('dispatches each fn to the matching writer method with its args', () => {
    const { w, calls } = recordingWriter();
    const edits: Edit[] = [
      { fn: 'insertText', node: 'b1', at: 2, text: 'x' },
      { fn: 'formatText', node: 'b1', match: 'a', format: 'bold', on: true, scope: { all: true } },
      { fn: 'setCell', table: 't', row: 1, col: 0, text: 'c' },
    ];
    for (const e of edits) applyEdit(w, e);
    expect(calls).toEqual([
      { fn: 'insertText', args: ['b1', 2, 'x'] },
      { fn: 'formatText', args: ['b1', 'a', 'bold', true, { all: true }] },
      { fn: 'setCell', args: ['t', 1, 0, 'c'] },
    ]);
  });
});

describe('describe + summarize', () => {
  it('describes ops as concise semantic lines', () => {
    expect(describeOp({ kind: 'formatText', id: 'b5', match: 'Bluejay', format: 'bold', on: true, scope: { all: true } })).toBe('bold "Bluejay" in {b5}');
    expect(describeOp({ kind: 'setBlockType', id: 'b1', block: 'heading', level: 2 })).toBe('{b1} → heading h2');
  });
  it('summarize emits only failed ops', () => {
    const out = summarize([
      { ok: true, op: { kind: 'removeBlock', id: 'b1' }, summary: 'removed {b1}' },
      { ok: false, op: { kind: 'removeBlock', id: 'b2' }, error: 'boom' },
    ]);
    expect(out).toBe('error: removeBlock: boom');
  });
});

describe('runQueue -- error in the middle keeps neighbors', () => {
  it('op N fails, op N-1 and N+1 succeed', async () => {
    const { w } = recordingWriter({ fn: 'moveNode', error: 'cannot move' });
    const { results } = await run(
      [
        { kind: 'setBlockType', id: 'b1', block: 'quote' }, // ok
        { kind: 'moveBlock', id: 'b2', at: { before: 'b3' } }, // throws
        { kind: 'setChecked', id: 'b4', checked: false }, // ok
      ],
      w
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1]!.ok).toBe(false);
    if (!results[1]!.ok) {
      expect(results[1]!.error).toBe('cannot move');
      expect(results[1]!.op.kind).toBe('moveBlock');
    }
  });

  it('two failures in a row are each recorded, surrounding ops survive', async () => {
    const { w } = recordingWriter([
      { fn: 'removeNode', error: 'gone' },
      { fn: 'setIndent', error: 'bad indent' },
    ]);
    const { results } = await run(
      [
        { kind: 'setChecked', id: 'b1', checked: true }, // ok
        { kind: 'removeBlock', id: 'b2' }, // throw
        { kind: 'setIndent', id: 'b3', indent: 'in' }, // throw
        { kind: 'sortList', id: 'b4', order: 'asc' }, // ok
      ],
      w
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, false, true]);
  });
});

describe('runQueue -- planning-time read failures attributed to the right op kind', () => {
  it('locate throw on a formatText op attributes to formatText', async () => {
    const { w } = recordingWriter();
    const docReader = reader({
      locate: () => {
        throw new Error('locate failed');
      },
    });
    const { results } = await run([{ kind: 'formatText', id: 'g', match: 'x', format: 'bold', on: true, scope: {} }], w, { docReader });
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(false);
    if (!results[0]!.ok) {
      expect(results[0]!.op.kind).toBe('formatText');
      expect(results[0]!.error).toBe('locate failed');
    }
  });

  it('cellNode throw on a setCell op attributes to setCell', async () => {
    const { w } = recordingWriter();
    const docReader = reader({
      cellNode: () => {
        throw new Error('no cell');
      },
    });
    const { results } = await run([{ kind: 'setCell', table: 't', row: 9, col: 9, content: 'x' }], w, { docReader });
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) expect(results[0].op.kind).toBe('setCell');
  });

  it('a planning failure mid-queue still lets later ops run', async () => {
    const { w, calls } = recordingWriter();
    let calledLocate = 0;
    const docReader = reader({
      locate: () => {
        calledLocate++;
        if (calledLocate === 1) throw new Error('first locate boom');
        return [{ node: 't1', start: 0, end: 1 }];
      },
    });
    const { results } = await run(
      [
        { kind: 'markText', id: 'b1', match: 'x', on: true, scope: {} }, // plan throws
        { kind: 'setBlockType', id: 'b2', block: 'quote' }, // ok
      ],
      w,
      { docReader }
    );
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(calls.map((c) => c.fn)).toEqual(['setBlockType']);
  });
});

describe('runQueue -- awareness ordering & sleep', () => {
  it('awareness is pumped in the exact step order', async () => {
    const { w } = recordingWriter();
    // appendText: cursor(end) then one chunked cursor (TYPE_CHUNK 3 > "ab").
    const { awareness } = await run([{ kind: 'appendText', id: 'b', text: 'ab' }], w, { docReader: reader({ textLength: () => 5 }) });
    expect(awareness.seen).toEqual<Awareness[]>([
      { type: 'cursor', node: 'b', at: 5 },
      { type: 'cursor', node: 'b', at: 7 },
    ]);
  });

  it('every pause ms is passed to the injected sleep, in order', async () => {
    const slept: number[] = [];
    const sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    const { w } = recordingWriter();
    // setChecked: focus = one settle pause. The mock returns its integer value
    // directly, so every pause ms is the chosen 145.
    await runQueue({
      ops: [{ kind: 'setChecked', id: 'b1', checked: true }], params: DEFAULT_QUEUE_PARAMS,
      randomSource: mockRandomSource({ integer: 145 }),
      docReader: reader(),
      docWriter: w,
      awarenessSource: recordingAwareness().source,
      sleep,
    });
    expect(slept).toEqual([145]);
  });

  it('edits and awareness interleave: a removeBlock pumps highlights before the remove', async () => {
    const events: string[] = [];
    const w = new Proxy({}, { get: (_t, fn: string) => () => events.push(`edit:${fn}`) }) as DocWriter;
    await runQueue({
      ops: [{ kind: 'removeBlock', id: 'b1' }], params: DEFAULT_QUEUE_PARAMS,
      randomSource: mockRandomSource({ integer: 0 }),
      docReader: reader({ textLength: () => 3 }),
      docWriter: w,
      awarenessSource: { apply: (x) => events.push(`aware:${x.type}`) },
      sleep: () => Promise.resolve(),
    });
    expect(events.at(-1)).toBe('edit:removeNode');
    expect(events.indexOf('aware:highlight')).toBeLessThan(events.indexOf('edit:removeNode'));
  });
});

describe('runQueue -- ref-dependent failures', () => {
  it('insertNode fails → later op on the same ref also fails, independent ops still succeed', async () => {
    // insertNode throws so the ref never resolves. The dependent op is an
    // appendText, which the animator expands into insertText edits -- the writer
    // throws on insertText (the unresolved-ref failure surfaces at apply time).
    const { w } = recordingWriter([
      { fn: 'insertNode', error: 'cannot insert' },
      { fn: 'insertText', error: 'unknown ref' }, // dependent op fails (ref unresolved)
    ]);
    const { results } = await run(
      [
        { kind: 'insertBlock', ref: 'ref-1', spec: { block: 'paragraph', text: 'x' }, at: { appendToRoot: true } }, // fails
        { kind: 'appendText', id: 'ref-1', text: 'Y' }, // dependent → fails
        { kind: 'setBlockType', id: 'b2', block: 'quote' }, // independent → ok
      ],
      w,
      { docReader: reader({ textLength: () => 0 }) }
    );
    expect(results.map((r) => r.ok)).toEqual([false, false, true]);
  });

  it('insertNode succeeds → dependent setText on the ref succeeds', async () => {
    const { w, calls } = recordingWriter();
    const { results } = await run(
      [
        { kind: 'insertBlock', ref: 'ref-9', spec: { block: 'paragraph', text: '' }, at: { appendToRoot: true } },
        { kind: 'appendText', id: 'ref-9', text: 'Z' },
      ],
      w,
      { docReader: reader({ textLength: () => 0 }) }
    );
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(calls.map((c) => c.fn)).toContain('insertNode');
    expect(calls.map((c) => c.fn)).toContain('insertText');
  });
});

describe('applyEdit -- every fn routes to its method', () => {
  const cases: Array<[Edit, { fn: string; args: unknown[] }]> = [
    [{ fn: 'removeText', node: 'b', at: 1, len: 2 }, { fn: 'removeText', args: ['b', 1, 2] }],
    [{ fn: 'setText', node: 'b', text: 't' }, { fn: 'setText', args: ['b', 't'] }],
    [{ fn: 'appendText', node: 'b', text: 't' }, { fn: 'appendText', args: ['b', 't'] }],
    [{ fn: 'prependText', node: 'b', text: 't' }, { fn: 'prependText', args: ['b', 't'] }],
    [{ fn: 'replaceText', node: 'b', find: 'a', to: 'b', scope: {} }, { fn: 'replaceText', args: ['b', 'a', 'b', {}] }],
    [{ fn: 'clearFormat', node: 'b', match: 'x', scope: { all: true } }, { fn: 'clearFormat', args: ['b', 'x', { all: true }] }],
    [{ fn: 'markText', node: 'b', match: 'x', on: false, scope: {} }, { fn: 'markText', args: ['b', 'x', false, {}] }],
    [{ fn: 'linkText', node: 'b', match: 'x', url: null, scope: {} }, { fn: 'linkText', args: ['b', 'x', null, {}] }],
    [{ fn: 'formatNode', node: 't', format: 'italic', on: true }, { fn: 'formatNode', args: ['t', 'italic', true] }],
    [{ fn: 'clearNodeFormat', node: 't' }, { fn: 'clearNodeFormat', args: ['t'] }],
    [{ fn: 'setBlockType', node: 'b', block: 'heading', level: 3 }, { fn: 'setBlockType', args: ['b', 'heading', { level: 3, language: undefined }] }],
    [{ fn: 'setListType', nodes: ['a', 'b'], list: 'number' }, { fn: 'setListType', args: [['a', 'b'], 'number'] }],
    [{ fn: 'appendListItem', ref: 'r', node: 'b', checked: false }, { fn: 'appendListItem', args: ['r', 'b', false] }],
    [{ fn: 'setChecked', node: 'b', checked: true }, { fn: 'setChecked', args: ['b', true] }],
    [{ fn: 'setIndent', node: 'b', indent: 'out' }, { fn: 'setIndent', args: ['b', 'out'] }],
    [{ fn: 'sortList', node: 'b', order: 'desc' }, { fn: 'sortList', args: ['b', 'desc'] }],
    [{ fn: 'insertNode', ref: 'r', spec: { block: 'divider' }, at: { appendToRoot: true } }, { fn: 'insertNode', args: ['r', { block: 'divider' }, { appendToRoot: true }] }],
    [{ fn: 'insertInline', ref: 'r', node: 'b', at: 2, spec: { inline: 'linebreak' } }, { fn: 'insertInline', args: ['r', 'b', 2, { inline: 'linebreak' }] }],
    [{ fn: 'moveNode', node: 'b', at: { before: 'c' } }, { fn: 'moveNode', args: ['b', { before: 'c' }] }],
    [{ fn: 'removeNode', node: 'b' }, { fn: 'removeNode', args: ['b'] }],
    [{ fn: 'mergeBlocks', nodes: ['a', 'b'], separator: '-' }, { fn: 'mergeBlocks', args: [['a', 'b'], '-'] }],
    [{ fn: 'splitBlock', node: 'b', atText: 'x' }, { fn: 'splitBlock', args: ['b', 'x'] }],
    [{ fn: 'insertListItemAfter', ref: 'r', node: 'b', text: 't', list: 'number' }, { fn: 'insertListItemAfter', args: ['r', 'b', 't', 'number'] }],
    [{ fn: 'insertListItemBefore', ref: 'r', node: 'b', text: 't', list: 'bullet' }, { fn: 'insertListItemBefore', args: ['r', 'b', 't', 'bullet'] }],
    [{ fn: 'removeListItem', node: 'b' }, { fn: 'removeListItem', args: ['b'] }],
    [{ fn: 'addRow', table: 't', at: 1 }, { fn: 'addRow', args: ['t', 1] }],
    [{ fn: 'addColumn', table: 't', at: undefined }, { fn: 'addColumn', args: ['t', undefined] }],
    [{ fn: 'removeRow', table: 't', row: 0 }, { fn: 'removeRow', args: ['t', 0] }],
    [{ fn: 'removeColumn', table: 't', col: 2 }, { fn: 'removeColumn', args: ['t', 2] }],
  ];
  it.each(cases)('routes %o', (edit, expected) => {
    const { w, calls } = recordingWriter();
    applyEdit(w, edit);
    expect(calls).toEqual([expected]);
  });
});

describe('describe -- summary lines', () => {
  it('covers branchy descriptions', () => {
    expect(describeOp({ kind: 'formatText', id: 'b', match: 'x', format: 'italic', on: false, scope: {} })).toBe('unitalic "x" in {b}');
    expect(describeOp({ kind: 'clearFormat', id: 'b', scope: {} })).toBe('cleared all formatting in {b}');
    expect(describeOp({ kind: 'clearFormat', id: 'b', match: 'y', scope: {} })).toBe('cleared formatting on "y" in {b}');
    expect(describeOp({ kind: 'markText', id: 'b', match: 'z', on: false, scope: {} })).toBe('unhighlighted "z" in {b}');
    expect(describeOp({ kind: 'linkText', id: 'b', match: 'z', url: null, scope: {} })).toBe('unlinked "z" in {b}');
    expect(describeOp({ kind: 'linkText', id: 'b', match: 'z', url: 'http://x', scope: {} })).toBe('linked "z" → http://x in {b}');
    expect(describeOp({ kind: 'setBlockType', id: 'b', block: 'paragraph' })).toBe('{b} → paragraph');
    expect(describeOp({ kind: 'setListType', ids: ['a', 'b'], list: 'bullet' })).toBe('{a, b} → bullet list');
    expect(describeOp({ kind: 'setChecked', id: 'b', checked: false })).toBe('{b} unchecked');
    expect(describeOp({ kind: 'insertBlock', ref: 'r', spec: { block: 'divider' }, at: { appendToRoot: true } })).toBe('inserted divider (r)');
    expect(describeOp({ kind: 'insertInline', ref: 'r', id: 'b', at: 3, spec: { inline: 'linebreak' } })).toBe('inserted linebreak in {b} @3');
    expect(describeOp({ kind: 'mergeBlocks', ids: ['a', 'b'], separator: ' ' })).toBe('merged {a, b}');
    expect(describeOp({ kind: 'setCell', table: 't', row: 2, col: 1, content: 'x' })).toBe('set cell [2, 1] of {t}');
    expect(describeOp({ kind: 'removeRow', table: 't', row: 3 })).toBe('removed row 3 of {t}');
  });

  it('truncates long setText content with an ellipsis at 40 chars', () => {
    const long = 'a'.repeat(50);
    const out = describeOp({ kind: 'setText', id: 'b', text: long });
    expect(out).toBe(`set {b} text to "${'a'.repeat(40)}…"`);
  });

  it('does not truncate text of exactly 40 chars', () => {
    const exact = 'b'.repeat(40);
    expect(describeOp({ kind: 'setText', id: 'b', text: exact })).toBe(`set {b} text to "${exact}"`);
  });
});

describe('summarize', () => {
  it('empty results → "ok"', () => {
    expect(summarize([])).toBe('ok');
  });
  it('a failed result includes the op kind prefix', () => {
    const results: OpResult[] = [{ ok: false, op: { kind: 'removeBlock', id: 'b1' }, error: 'planning blew up' }];
    expect(summarize(results)).toBe('error: removeBlock: planning blew up');
  });
  it('omits ok lines when mixed with failures', () => {
    const results: OpResult[] = [
      { ok: true, op: { kind: 'removeBlock', id: 'b1' }, summary: 'removed {b1}' },
      { ok: false, op: { kind: 'setText', id: 'b2', text: 'x' }, error: 'nope' },
    ];
    expect(summarize(results)).toBe('error: setText: nope');
  });
});

describe('runQueue -- empty queue short-circuit', () => {
  it('never touches the writer, reader, or awareness', async () => {
    const apply = vi.fn();
    const { w, calls } = recordingWriter();
    const results = await runQueue({
      ops: [], params: DEFAULT_QUEUE_PARAMS,
      randomSource: mockRandomSource(),
      docReader: reader(),
      docWriter: w,
      awarenessSource: { apply },
      sleep: () => Promise.resolve(),
    });
    expect(results).toEqual([]);
    expect(calls).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
  });
});
