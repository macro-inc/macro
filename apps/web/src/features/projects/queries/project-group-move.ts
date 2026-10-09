import type { GanttGroupMove } from '@app/components/gantt/gantt-group-drag';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property, PropertyApiValues } from '@property/types';
import type { ProjectListGroupBy } from '../primitives/project-collection';

export function projectGroupPropertyId(
  grouping: ProjectListGroupBy
): string | undefined {
  return {
    none: undefined,
    status: SYSTEM_PROPERTY_IDS.STATUS,
    priority: SYSTEM_PROPERTY_IDS.PRIORITY,
    assignee: SYSTEM_PROPERTY_IDS.ASSIGNEES,
  }[grouping];
}

/** Replace only the dragged assignee occurrence; keep all other references intact. */
export function projectGroupMoveValue(
  properties: readonly Property[],
  grouping: ProjectListGroupBy,
  move: GanttGroupMove
): PropertyApiValues | undefined {
  if (grouping === 'none' || move.fromGroup === move.toGroup) return;
  const property = properties.find(
    (value) => value.propertyDefinitionId === projectGroupPropertyId(grouping)
  );
  if (grouping !== 'assignee') {
    const current =
      property?.valueType === 'SELECT_STRING'
        ? (property.value?.[0] ?? '')
        : '';
    if (current !== move.fromGroup) return;
    return {
      valueType: 'SELECT_STRING',
      values: move.toGroup ? [move.toGroup] : null,
    };
  }
  const refs = property?.valueType === 'ENTITY' ? (property.value ?? []) : [];
  const users = refs.filter((ref) => ref.entity_type === 'USER');
  if (
    move.fromGroup
      ? !users.some((ref) => ref.entity_id === move.fromGroup)
      : users.length > 0
  )
    return;
  if (!move.toGroup) return { valueType: 'ENTITY', refs: null };
  const next = refs.filter((ref) => ref.entity_id !== move.fromGroup);
  if (!next.some((ref) => ref.entity_id === move.toGroup)) {
    next.push({ entity_id: move.toGroup, entity_type: 'USER' });
  }
  return { valueType: 'ENTITY', refs: next };
}
