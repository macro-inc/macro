import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from './database-view';
import { rowTitle } from './table';

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

  it('prefers the text title even when an entity column comes first', () => {
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
    ).toBe('Launch plan');
  });
});
