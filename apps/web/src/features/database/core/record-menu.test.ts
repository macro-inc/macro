import { expect, it } from 'vitest';
import { databaseRecordMenuGroups } from './record-menu';

it('puts Open first, modifications together and Delete last', () => {
  expect(
    databaseRecordMenuGroups({
      editCell: true,
      saved: true,
      rename: true,
      duplicate: true,
      delete: true,
    })
  ).toEqual([['open'], ['edit-cell', 'rename', 'duplicate'], ['delete']]);
});

it('does not offer saved-record actions for a new record', () => {
  expect(
    databaseRecordMenuGroups({
      editCell: true,
      saved: false,
      rename: true,
      duplicate: true,
      delete: true,
    })
  ).toEqual([['edit-cell']]);
  expect(
    databaseRecordMenuGroups({
      editCell: false,
      saved: true,
      rename: false,
      duplicate: false,
      delete: false,
    })
  ).toEqual([['open']]);
});
