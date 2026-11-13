import { describe, expect, it } from 'vitest';
import { buildSessionTree, parentSessionOf } from './session-tree';

type S = { id: string; parent?: string };
const ids = (nodes: ReturnType<typeof buildSessionTree<S>>): unknown =>
  nodes.map((node) =>
    node.children.length
      ? { [node.session.id]: ids(node.children) }
      : node.session.id
  );

describe('buildSessionTree', () => {
  it('puts sub-agents under the listed session that started them', () => {
    const sessions: S[] = [
      { id: 'child-new', parent: 'root' },
      { id: 'root' },
      { id: 'grandchild', parent: 'child-old' },
      { id: 'child-old', parent: 'root' },
      { id: 'orphan', parent: 'not-listed' },
    ];
    expect(ids(buildSessionTree(sessions, (s) => s.parent, 10))).toEqual([
      { root: ['child-new', { 'child-old': ['grandchild'] }] },
      'orphan',
    ]);
  });

  it('caps the roots but keeps every child of a shown root', () => {
    const sessions: S[] = [
      { id: 'a' },
      { id: 'a1', parent: 'a' },
      { id: 'a2', parent: 'a' },
      { id: 'b' },
      { id: 'c' },
    ];
    expect(ids(buildSessionTree(sessions, (s) => s.parent, 2))).toEqual([
      { a: ['a1', 'a2'] },
      'b',
    ]);
  });

  it('never loses a session to a parent cycle', () => {
    const sessions: S[] = [
      { id: 'x', parent: 'y' },
      { id: 'y', parent: 'x' },
      { id: 'self', parent: 'self' },
    ];
    expect(ids(buildSessionTree(sessions, (s) => s.parent, 10))).toEqual([
      'x',
      'y',
      'self',
    ]);
  });
});

describe('parentSessionOf', () => {
  it('reads the acting session from an agent caller', () => {
    expect(
      parentSessionOf({
        origin: 'message',
        by: {
          type: 'agent',
          bot: 'bot-1',
          lineage: { type: 'session', session: 'parent-1', root: {} },
        },
      })
    ).toBe('parent-1');
  });

  it('has none for a person, a routine, or no origin', () => {
    expect(parentSessionOf({ by: { type: 'user', id: 'u' } })).toBeUndefined();
    expect(
      parentSessionOf({ by: { lineage: { type: 'root' } } })
    ).toBeUndefined();
    expect(parentSessionOf({ origin: 'routine' })).toBeUndefined();
    expect(parentSessionOf(undefined)).toBeUndefined();
  });
});
