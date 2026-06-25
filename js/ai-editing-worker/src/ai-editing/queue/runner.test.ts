import { describe, expect, it, vi } from 'vitest';
import type { DocReader, DocWriter } from '../doc/interfaces';
import type { DocumentOp } from '../editor/ops';
import { recordingAwareness, recordingWriter } from './_testUtils';
import { mockRandomSource } from './random-source';
import { type OpResult, runQueue, summarize } from './runner';
import type { Awareness } from './types';
import { DEFAULT_QUEUE_PARAMS } from './types';

const reader = (over: Partial<DocReader> = {}): DocReader => ({
  locate: () => [{ node: 't1', start: 0, end: 3 }],
  textLength: () => 4,
  cellNode: () => 'cell',
  ...over,
});

async function run(
  ops: DocumentOp[],
  writer: DocWriter,
  opts: { docReader?: DocReader; sleep?: (ms: number) => Promise<void> } = {}
) {
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
    const { w, edits } = recordingWriter();
    const { results, awareness } = await run(
      [
        { kind: 'setBlockType', node: 'b1', block: 'heading', level: 2 },
        { kind: 'removeNode', node: 'b2' },
      ],
      w
    );
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(edits.map((e) => e.kind)).toEqual(['setBlockType', 'removeNode']);
    expect(awareness.seen.length).toBeGreaterThan(0); // cursors/highlights were pumped
  });

  it('expands a setText op into remove + chunked insert edits', async () => {
    const { w, edits } = recordingWriter();
    // typeText emits TYPE_CHUNK (3) chars per keystroke, so "Hi" is one insert.
    await run([{ kind: 'setText', node: 'b1', text: 'Hi' }], w, {
      docReader: reader({ textLength: () => 4 }),
    });
    expect(edits.map((e) => e.kind)).toEqual(['removeText', 'insertText']);
    expect(edits[1]).toMatchObject({
      kind: 'insertText',
      node: 'b1',
      at: 0,
      text: 'Hi',
    });
  });

  it('awaits pauses through the injected sleep', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await runQueue({
      ops: [{ kind: 'setBlockType', node: 'b1', block: 'quote' }],
      params: DEFAULT_QUEUE_PARAMS,
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
    const { w } = recordingWriter({ kind: 'removeNode', error: 'boom' });
    const { results } = await run(
      [
        { kind: 'setBlockType', node: 'b1', block: 'quote' }, // ok
        { kind: 'removeNode', node: 'b2' }, // throws
        { kind: 'setChecked', node: 'b3', checked: true }, // still runs
      ],
      w
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    const failed = results[1]!;
    expect(failed.ok).toBe(false);
    if (failed.ok === false) expect(failed.error).toBe('boom');
  });

  it('attributes a planning-time read failure to the stepped op', async () => {
    const { w } = recordingWriter();
    const docReader = reader({
      textLength: () => {
        throw new Error('no node');
      },
    });
    // setText animator reads textLength during step → throws while planning
    const { results } = await run(
      [{ kind: 'setText', node: 'ghost', text: 'x' }],
      w,
      { docReader }
    );
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) expect(results[0].op.kind).toBe('setText');
  });

});

describe('runQueue -- error in the middle keeps neighbors', () => {
  it('op N fails, op N-1 and N+1 succeed', async () => {
    const { w } = recordingWriter({ kind: 'moveNode', error: 'cannot move' });
    const { results } = await run(
      [
        { kind: 'setBlockType', node: 'b1', block: 'quote' }, // ok
        { kind: 'moveNode', node: 'b2', at: { before: 'b3' } }, // throws
        { kind: 'setChecked', node: 'b4', checked: false }, // ok
      ],
      w
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    const r1 = results[1]!;
    expect(r1.ok).toBe(false);
    if (r1.ok === false) {
      expect(r1.error).toBe('cannot move');
      expect(r1.op.kind).toBe('moveNode');
    }
  });

  it('two failures in a row are each recorded, surrounding ops survive', async () => {
    const { w } = recordingWriter([
      { kind: 'removeNode', error: 'gone' },
      { kind: 'setIndent', error: 'bad indent' },
    ]);
    const { results } = await run(
      [
        { kind: 'setChecked', node: 'b1', checked: true }, // ok
        { kind: 'removeNode', node: 'b2' }, // throw
        { kind: 'setIndent', node: 'b3', indent: 'in' }, // throw
      ],
      w
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, false]);
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
    const { results } = await run(
      [
        {
          kind: 'formatText',
          node: 'g',
          match: 'x',
          format: 'bold',
          on: true,
          scope: { kind: 'all' },
        },
      ],
      w,
      { docReader }
    );
    expect(results).toHaveLength(1);
    const r0 = results[0]!;
    expect(r0.ok).toBe(false);
    if (r0.ok === false) {
      expect(r0.op.kind).toBe('formatText');
      expect(r0.error).toBe('locate failed');
    }
  });

  it('cellNode throw on a setCell op attributes to setCell', async () => {
    const { w } = recordingWriter();
    const docReader = reader({
      cellNode: () => {
        throw new Error('no cell');
      },
    });
    const { results } = await run(
      [{ kind: 'setCell', table: 't', row: 9, col: 9, text: 'x' }],
      w,
      { docReader }
    );
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) expect(results[0].op.kind).toBe('setCell');
  });

  it('a planning failure mid-queue still lets later ops run', async () => {
    const { w, edits } = recordingWriter();
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
        {
          kind: 'markText',
          node: 'b1',
          match: 'x',
          on: true,
          scope: { kind: 'all' },
        }, // plan throws
        { kind: 'setBlockType', node: 'b2', block: 'quote' }, // ok
      ],
      w,
      { docReader }
    );
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(edits.map((e) => e.kind)).toEqual(['setBlockType']);
  });
});

describe('runQueue -- awareness ordering & sleep', () => {
  it('awareness is pumped in the exact step order', async () => {
    const { w } = recordingWriter();
    // appendText: cursor(end) then one chunked cursor (TYPE_CHUNK 3 > "ab").
    const { awareness } = await run(
      [{ kind: 'appendText', node: 'b', text: 'ab' }],
      w,
      { docReader: reader({ textLength: () => 5 }) }
    );
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
      ops: [{ kind: 'setChecked', node: 'b1', checked: true }],
      params: DEFAULT_QUEUE_PARAMS,
      randomSource: mockRandomSource({ integer: 145 }),
      docReader: reader(),
      docWriter: w,
      awarenessSource: recordingAwareness().source,
      sleep,
    });
    expect(slept).toEqual([145]);
  });

  it('edits and awareness interleave: a removeNode pumps highlights before the remove', async () => {
    const events: string[] = [];
    const w: DocWriter = {
      apply(op) {
        events.push(`edit:${op.kind}`);
      },
    };
    await runQueue({
      ops: [{ kind: 'removeNode', node: 'b1' }],
      params: DEFAULT_QUEUE_PARAMS,
      randomSource: mockRandomSource({ integer: 0 }),
      docReader: reader({ textLength: () => 3 }),
      docWriter: w,
      awarenessSource: { apply: (x) => events.push(`aware:${x.type}`) },
      sleep: () => Promise.resolve(),
    });
    expect(events.at(-1)).toBe('edit:removeNode');
    expect(events.indexOf('aware:highlight')).toBeLessThan(
      events.indexOf('edit:removeNode')
    );
  });
});

describe('runQueue -- ref-dependent failures', () => {
  it('insertNode fails → later op on the same ref also fails, independent ops still succeed', async () => {
    // insertNode throws so the ref never resolves. The dependent op is an
    // appendText, which the animator expands into insertText edits -- the writer
    // throws on insertText (the unresolved-ref failure surfaces at apply time).
    const { w } = recordingWriter([
      { kind: 'insertNode', error: 'cannot insert' },
      { kind: 'insertText', error: 'unknown ref' }, // dependent op fails (ref unresolved)
    ]);
    const { results } = await run(
      [
        {
          kind: 'insertNode',
          ref: 'ref-1',
          spec: { block: 'paragraph', text: 'x' },
          at: { appendToRoot: true },
        }, // fails
        { kind: 'appendText', node: 'ref-1', text: 'Y' }, // dependent → fails
        { kind: 'setBlockType', node: 'b2', block: 'quote' }, // independent → ok
      ],
      w,
      { docReader: reader({ textLength: () => 0 }) }
    );
    expect(results.map((r) => r.ok)).toEqual([false, false, true]);
  });

  it('insertNode succeeds → dependent setText on the ref succeeds', async () => {
    const { w, edits } = recordingWriter();
    const { results } = await run(
      [
        {
          kind: 'insertNode',
          ref: 'ref-9',
          spec: { block: 'paragraph', text: '' },
          at: { appendToRoot: true },
        },
        { kind: 'appendText', node: 'ref-9', text: 'Z' },
      ],
      w,
      { docReader: reader({ textLength: () => 0 }) }
    );
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(edits.map((e) => e.kind)).toContain('insertNode');
    expect(edits.map((e) => e.kind)).toContain('insertText');
  });
});

describe('summarize', () => {
  it('empty results → "ok"', () => {
    expect(summarize([])).toBe('ok');
  });
  it('a failed result includes the op kind prefix', () => {
    const results: OpResult[] = [
      {
        ok: false,
        op: { kind: 'removeNode', node: 'b1' },
        error: 'planning blew up',
      },
    ];
    expect(summarize(results)).toBe('error: removeNode: planning blew up');
  });
});

describe('runQueue -- empty queue short-circuit', () => {
  it('never touches the writer, reader, or awareness', async () => {
    const apply = vi.fn();
    const { w, edits } = recordingWriter();
    const results = await runQueue({
      ops: [],
      params: DEFAULT_QUEUE_PARAMS,
      randomSource: mockRandomSource(),
      docReader: reader(),
      docWriter: w,
      awarenessSource: { apply },
      sleep: () => Promise.resolve(),
    });
    expect(results).toEqual([]);
    expect(edits).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
  });
});
