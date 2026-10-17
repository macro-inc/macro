import { describe, expect, it } from 'vitest';
import { buildGroupedSoupRows, getSoupMenuEntities } from './rows';

describe('getSoupMenuEntities', () => {
  const rows = [
    { id: 'a', type: 'initiative' },
    { id: 'b', type: 'initiative' },
    { id: 'c', type: 'initiative' },
  ];

  it('acts on the selection when the clicked row is part of it', () => {
    expect(getSoupMenuEntities(rows[1], rows.slice(0, 2))).toEqual(
      rows.slice(0, 2)
    );
  });

  it('acts on the clicked row outside a selection or with one selected', () => {
    expect(getSoupMenuEntities(rows[2], rows.slice(0, 2))).toEqual([rows[2]]);
    expect(getSoupMenuEntities(rows[0], [rows[0]])).toEqual([rows[0]]);
    expect(getSoupMenuEntities(rows[0], [])).toEqual([rows[0]]);
  });
});

describe('buildGroupedSoupRows keyed by entity', () => {
  const thread = { id: 't1', type: 'email' };
  const other = { id: 't2', type: 'email' };
  const rowIdOf = (rows: { kind: string; id: string }[], index: number) =>
    rows.filter((row) => row.kind === 'entity')[index]?.id;

  it('keeps a row id when its entity moves to another group', () => {
    const before = buildGroupedSoupRows(
      [
        { id: 'today', label: 'Today', entities: [other] },
        { id: 'yesterday', label: 'Yesterday', entities: [thread] },
      ],
      { keyByEntity: true }
    );
    // A reply arrives: the thread is now today's.
    const after = buildGroupedSoupRows(
      [{ id: 'today', label: 'Today', entities: [thread, other] }],
      { keyByEntity: true }
    );

    expect(rowIdOf(after, 0)).toBe(rowIdOf(before, 1));
    expect(rowIdOf(after, 1)).toBe(rowIdOf(before, 0));
  });

  it('still gives an entity listed in two groups two rows', () => {
    const rows = buildGroupedSoupRows(
      [
        { id: 'today', label: 'Today', entities: [thread] },
        { id: 'yesterday', label: 'Yesterday', entities: [thread] },
      ],
      { keyByEntity: true }
    );

    expect(rowIdOf(rows, 0)).not.toBe(rowIdOf(rows, 1));
  });
});
