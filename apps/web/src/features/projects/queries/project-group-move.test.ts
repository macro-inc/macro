import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { expect, it } from 'vitest';
import { projectGroupMoveValue } from './project-group-move';

const assignments = (
  value: { entity_id: string; entity_type: 'USER' | 'DOCUMENT' }[]
): Property[] => [
  {
    propertyId: 'assignees',
    propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
    displayName: 'Assignees',
    valueType: 'ENTITY',
    value,
    isMultiSelect: true,
    owner: { scope: 'system' },
    createdAt: '',
    updatedAt: '',
  },
];
const move = { id: 'project', fromGroup: 'alice', toGroup: 'bob' };

it('replaces only the dragged assignee, preserves other references, and does not duplicate an existing destination', () => {
  const others = [
    { entity_id: 'charlie', entity_type: 'USER' as const },
    { entity_id: 'document', entity_type: 'DOCUMENT' as const },
  ];
  const properties = assignments([
    { entity_id: 'alice', entity_type: 'USER' },
    ...others,
  ]);
  expect(projectGroupMoveValue(properties, 'assignee', move)).toEqual({
    valueType: 'ENTITY',
    refs: [...others, { entity_id: 'bob', entity_type: 'USER' }],
  });
  const existing = assignments([
    { entity_id: 'alice', entity_type: 'USER' },
    { entity_id: 'bob', entity_type: 'USER' },
    ...others,
  ]);
  expect(projectGroupMoveValue(existing, 'assignee', move)).toEqual({
    valueType: 'ENTITY',
    refs: [{ entity_id: 'bob', entity_type: 'USER' }, ...others],
  });
  expect(
    projectGroupMoveValue(properties, 'assignee', { ...move, toGroup: '' })
  ).toEqual({ valueType: 'ENTITY', refs: null });
});

it('rejects stale assignee occurrences and refuses to treat an assigned project as unassigned', () => {
  const properties = assignments([{ entity_id: 'alice', entity_type: 'USER' }]);
  expect(
    projectGroupMoveValue(properties, 'assignee', { ...move, fromGroup: 'old' })
  ).toBeUndefined();
  expect(
    projectGroupMoveValue(properties, 'assignee', { ...move, fromGroup: '' })
  ).toBeUndefined();
  expect(
    projectGroupMoveValue(properties, 'assignee', { ...move, toGroup: 'alice' })
  ).toBeUndefined();
});
