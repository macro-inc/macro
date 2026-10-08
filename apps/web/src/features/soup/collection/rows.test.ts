import { describe, expect, it } from 'vitest';
import { getSoupMenuEntities } from './rows';

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
