import type { SerializedEditorState } from 'lexical';
import { describe, expect, it } from 'vitest';
import { type Change, diffTrees } from './tree-diff';

// Hand-built snapshots keep these tests pure (no editor) — diffTrees is JSON-in.
const text = (id: string, t: string, attrs: Record<string, unknown> = {}) => ({
  type: 'text',
  text: t,
  $: { id },
  ...attrs,
});
const para = (id: string, kids: unknown[]) => ({ type: 'paragraph', children: kids, $: { id } });
const doc = (children: unknown[]) =>
  ({ root: { type: 'root', children } }) as unknown as SerializedEditorState;

const onlyKinds = (cs: Change[]) => cs.map((c) => c.kind);

describe('diffTrees', () => {
  it('reports no changes for identical trees', () => {
    const a = doc([para('p1', [text('t1', 'hello')])]);
    expect(diffTrees(a, a)).toEqual([]);
  });

  it('detects a text edit (same id)', () => {
    const before = doc([para('p1', [text('t1', 'hello')])]);
    const after = doc([para('p1', [text('t1', 'world')])]);
    expect(diffTrees(before, after)).toEqual([
      { kind: 'setText', id: 't1', type: 'text', from: 'hello', to: 'world' },
    ]);
  });

  it('detects an inserted block, positioned by neighbor id', () => {
    const before = doc([para('p1', [text('t1', 'a')])]);
    const after = doc([para('p1', [text('t1', 'a')]), para('p2', [text('t2', 'b')])]);
    const changes = diffTrees(before, after);
    expect(changes).toContainEqual({
      kind: 'insert',
      id: 'p2',
      type: 'paragraph',
      parentId: 'root',
      afterId: 'p1',
    });
  });

  it('detects a deleted block', () => {
    const before = doc([para('p1', [text('t1', 'a')]), para('p2', [text('t2', 'b')])]);
    const after = doc([para('p1', [text('t1', 'a')])]);
    expect(diffTrees(before, after)).toContainEqual({ kind: 'delete', id: 'p2', type: 'paragraph' });
    // the deleted block's text child is gone too
    expect(diffTrees(before, after)).toContainEqual({ kind: 'delete', id: 't2', type: 'text' });
  });

  it('detects a reorder as a move (neighbor changed)', () => {
    const before = doc([para('p1', [text('t1', 'a')]), para('p2', [text('t2', 'b')])]);
    const after = doc([para('p2', [text('t2', 'b')]), para('p1', [text('t1', 'a')])]);
    const moves = diffTrees(before, after).filter((c) => c.kind === 'move');
    expect(moves).toContainEqual({
      kind: 'move',
      id: 'p1',
      type: 'paragraph',
      parentId: 'root',
      afterId: 'p2',
    });
  });

  it('detects an attribute change (e.g. bold via format bitmask)', () => {
    const before = doc([para('p1', [text('t1', 'hi', { format: 0 })])]);
    const after = doc([para('p1', [text('t1', 'hi', { format: 1 })])]);
    expect(diffTrees(before, after)).toEqual([
      { kind: 'setAttrs', id: 't1', type: 'text', changed: { format: { from: 0, to: 1 } } },
    ]);
  });

  it('emits both move and setText for a node that moved and changed', () => {
    const before = doc([para('p1', [text('t1', 'a')]), para('p2', [text('t2', 'b')])]);
    const after = doc([para('p2', [text('t2', 'B')]), para('p1', [text('t1', 'a')])]);
    expect(onlyKinds(diffTrees(before, after))).toContain('move');
    expect(diffTrees(before, after)).toContainEqual({
      kind: 'setText',
      id: 't2',
      type: 'text',
      from: 'b',
      to: 'B',
    });
  });

  it('treats a type swap (heading↔paragraph) as a kept id with a type attr change', () => {
    const before = doc([{ type: 'heading', tag: 'h2', children: [text('t1', 'Notes')], $: { id: 'b1' } }]);
    const after = doc([para('b1', [text('t1', 'Notes')])]);
    const attrChange = diffTrees(before, after).find((c) => c.id === 'b1' && c.kind === 'setAttrs');
    expect(attrChange).toMatchObject({ changed: { type: { from: 'heading', to: 'paragraph' } } });
  });
});
