import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from './database-view';
import { formatCellValue, optimisticRows, rowTitle } from './table';

describe('record title', () => {
  const entity: DatabaseViewColumn = {
    id: 'person',
    name: 'Person',
    dataType: 'ENTITY',
    specificEntityType: 'USER',
    writable: true,
    isMultiSelect: false,
    options: [],
  };

  it('keeps raw entity IDs out of titles when there is no text column', () => {
    expect(
      rowTitle({ rowId: 'row', cells: { person: 'macro|ada@example.com' } }, [
        entity,
      ])
    ).toBe('Linked record');
    expect(rowTitle({ rowId: 'row', cells: { person: null } }, [entity])).toBe(
      'Unnamed'
    );
  });

  it('names a record by the first column, even when a text column follows', () => {
    const name: DatabaseViewColumn = {
      ...entity,
      id: 'name',
      name: 'Name',
      dataType: 'STRING',
      specificEntityType: undefined,
    };
    expect(
      rowTitle(
        {
          rowId: 'row',
          cells: { person: 'macro|ada@example.com', name: 'Launch plan' },
        },
        [entity, name]
      )
    ).toBe('Linked record');
    expect(
      rowTitle(
        {
          rowId: 'row',
          cells: { person: 'macro|ada@example.com', name: 'Launch plan' },
        },
        [name, entity]
      )
    ).toBe('Launch plan');
    // Moving a custom column before a pipeline's primary reference keeps its identity.
    expect(
      rowTitle(
        {
          rowId: 'row',
          cells: { person: 'macro|ada@example.com', name: 'Launch plan' },
        },
        [name, { ...entity, primary: true }]
      )
    ).toBe('Linked record');
  });
});

describe('optimistic rows', () => {
  it('keeps each row no write touches as the very same row', () => {
    const ada = { rowId: 'ada', cells: { name: 'Ada', rsvp: 'Yes' } };
    const grace = { rowId: 'grace', cells: { name: 'Grace', rsvp: 'No' } };

    const shown = optimisticRows(
      [ada, grace],
      [{ kind: 'cell', rowId: 'grace', columnId: 'rsvp', value: 'Yes' }]
    );

    expect(shown).toEqual([
      { rowId: 'ada', cells: { name: 'Ada', rsvp: 'Yes' } },
      { rowId: 'grace', cells: { name: 'Grace', rsvp: 'Yes' } },
    ]);
    // The grid redraws a row whose object changed; Ada's must not.
    expect(shown[0]).toBe(ada);
  });
});

describe('date-range cells', () => {
  it('shows the days a range spans, compactly', () => {
    // Intl sets the dash between thin spaces.
    const trip: DatabaseViewColumn = {
      id: 'trip',
      name: 'Trip',
      dataType: 'DATE_RANGE',
      isMultiSelect: false,
      options: [],
      writable: true,
    };
    expect(
      formatCellValue(trip, '2026-03-01T00:00:00.000Z/2026-03-05T00:00:00.000Z')
    ).toBe('Mar 1\u2009–\u20095, 2026');
    expect(
      formatCellValue(trip, '2026-12-30T00:00:00.000Z/2027-01-02T00:00:00.000Z')
    ).toBe('Dec 30, 2026\u2009–\u2009Jan 2, 2027');
  });
});
