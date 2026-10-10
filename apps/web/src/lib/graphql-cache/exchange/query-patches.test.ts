import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { QueryPatch, QuerySpliceOp } from '../protocol';
import { applyQueryPatches, queryDelta } from './query-patches';

type Row = { __typename: 'Row'; id: string; label: string };
const row = (id: string, label = id): Row => ({
  __typename: 'Row',
  id,
  label,
});

describe('query splice patches', () => {
  it('splices a keyed list into a new snapshot that shares surviving rows', () => {
    const base = {
      user: { rows: [row('a'), row('b'), row('c')] },
      other: { untouched: true },
    };
    const next = applyQueryPatches(base, [
      {
        path: ['user', 'rows'],
        splice: [
          { remove: 1 },
          { insert: 0, value: row('d') },
          { move: 2, to: 1 },
        ],
      },
      { path: ['user', 'rows', 1, 'label'], value: 'moved' },
    ]) as typeof base;
    expect(next.user.rows).toEqual([row('d'), row('c', 'moved'), row('a')]);
    // Unchanged rows and unrelated branches keep their objects; changed paths
    // are copies, so the earlier snapshot stays intact.
    expect(next.user.rows[2]).toBe(base.user.rows[0]);
    expect(next.other).toBe(base.other);
    expect(next.user.rows[1]).not.toBe(base.user.rows[2]);
    expect(base.user.rows).toEqual([row('a'), row('b'), row('c')]);
    // Field patches record what they replaced in post-splice coordinates.
    expect(queryDelta(next)?.previous).toEqual([undefined, 'c']);
  });

  it('rejects invalid splices and patches before their splice without changing the base', () => {
    const base = { rows: [row('a'), row('b')] };
    const invalid: QueryPatch[][] = [
      [{ path: ['rows'], splice: [{ remove: 2 }] }],
      [{ path: ['rows'], splice: [{ insert: 3, value: row('x') }] }],
      [{ path: ['rows'], splice: [{ move: 0, to: 2 }] }],
      [{ path: ['rows', 0], splice: [{ remove: 0 }] }],
      [
        { path: ['rows', 0, 'label'], value: 'early' },
        { path: ['rows'], splice: [{ remove: 0 }] },
      ],
      [
        { path: ['rows'], value: [] },
        { path: ['rows'], splice: [{ remove: 0 }] },
      ],
      [
        { path: ['rows'], splice: [{ remove: 0 }] },
        { path: ['rows'], splice: [{ remove: 0 }] },
      ],
    ];
    for (const patches of invalid)
      expect(() => applyQueryPatches(base, patches)).toThrow();
    expect(base).toEqual({ rows: [row('a'), row('b')] });
  });

  it('reproduces any keyed reorder from random operation sequences', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 12 }),
        fc.array(
          fc.tuple(
            fc.constantFrom('remove', 'insert', 'move'),
            fc.nat(),
            fc.nat()
          ),
          { maxLength: 12 }
        ),
        (ids, edits) => {
          const before = ids.map((id) => row(String(id)));
          const expected = [...before];
          const ops: QuerySpliceOp[] = [];
          let fresh = 100;
          for (const [kind, first, second] of edits) {
            if (kind === 'insert') {
              const at = first % (expected.length + 1);
              const value = row(String(fresh++));
              expected.splice(at, 0, value);
              ops.push({ insert: at, value });
            } else if (expected.length) {
              const from = first % expected.length;
              const [item] = expected.splice(from, 1);
              if (kind === 'remove') {
                ops.push({ remove: from });
              } else {
                const to = second % (expected.length + 1);
                expected.splice(to, 0, item);
                ops.push({ move: from, to });
              }
            }
          }
          const base = { rows: before };
          const next = applyQueryPatches(base, [
            { path: ['rows'], splice: ops },
          ]) as typeof base;
          expect(next.rows).toEqual(expected);
          for (const item of next.rows)
            if (before.includes(item)) expect(base.rows).toContain(item);
          expect(base.rows).toEqual(before);
        }
      )
    );
  });
});
