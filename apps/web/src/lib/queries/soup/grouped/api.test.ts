import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { expect, it } from 'vitest';
import { makeGroupComparator } from './api';
import { type GroupMeta, NOT_SET_GROUP_KEY } from './types';

const group = (key: string, label: string): GroupMeta => ({
  key,
  label,
  displayOrder: null,
  totalCount: 1,
  itemIds: [],
  nextCursor: null,
});

it('orders project groups by name with No Project last', () => {
  const groups = () => [
    group(NOT_SET_GROUP_KEY, 'No Project'),
    group('b0000000-0000-0000-0000-000000000002', 'Website relaunch'),
    group('a0000000-0000-0000-0000-000000000001', 'Q4 planning'),
  ];
  const ordered = ['Q4 planning', 'Website relaunch', 'No Project'];

  expect(
    groups()
      .sort(makeGroupComparator({ type: 'project' }))
      .map((g) => g.label)
  ).toEqual(ordered);
  expect(
    groups()
      .sort(
        makeGroupComparator({
          type: 'property',
          propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
        })
      )
      .map((g) => g.label)
  ).toEqual(ordered);
});
