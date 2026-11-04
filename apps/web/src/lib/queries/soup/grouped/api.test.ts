import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
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

it('keeps priority groups urgent-first despite ascending server display order', () => {
  const groups: GroupMeta[] = [
    { ...group(PROPERTY_OPTION_IDS.PRIORITY.LOW, 'Low'), displayOrder: 0 },
    { ...group(NOT_SET_GROUP_KEY, 'No priority'), displayOrder: -1 },
    {
      ...group(PROPERTY_OPTION_IDS.PRIORITY.MEDIUM, 'Medium'),
      displayOrder: 1,
    },
    { ...group(PROPERTY_OPTION_IDS.PRIORITY.HIGH, 'High'), displayOrder: 2 },
    {
      ...group(PROPERTY_OPTION_IDS.PRIORITY.URGENT, 'Urgent'),
      displayOrder: 3,
    },
  ];

  const compare = makeGroupComparator({
    type: 'property',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
  });

  expect(groups.sort(compare).map((g) => g.label)).toEqual([
    'Urgent',
    'High',
    'Medium',
    'Low',
    'No priority',
  ]);
  expect(
    groups
      .map((g) => ({ ...g, displayOrder: null }))
      .reverse()
      .sort(compare)
      .map((g) => g.label)
  ).toEqual(['Urgent', 'High', 'Medium', 'Low', 'No priority']);
});

it('keeps stored group ordering for status and custom properties', () => {
  for (const propertyDefinitionId of [
    SYSTEM_PROPERTY_IDS.STATUS,
    '10000000-0000-4000-8000-000000000001',
  ]) {
    const groups: GroupMeta[] = [
      {
        ...group(PROPERTY_OPTION_IDS.PRIORITY.URGENT, 'Last option'),
        displayOrder: 3,
      },
      { ...group(NOT_SET_GROUP_KEY, 'Not set'), displayOrder: -1 },
      {
        ...group(PROPERTY_OPTION_IDS.PRIORITY.LOW, 'First option'),
        displayOrder: 0,
      },
    ];

    expect(
      groups
        .sort(
          makeGroupComparator({
            type: 'property',
            propertyDefinitionId,
          })
        )
        .map((g) => g.label)
    ).toEqual(['First option', 'Last option', 'Not set']);
  }
});
