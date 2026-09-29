import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { PendingProject, ProjectRow } from '../context/projects-context';
import type { ProjectFilters } from '../core/project';
import { withProjectPropertyValue } from './property-draft';

function pendingProjectRow(project: PendingProject): ProjectRow {
  return {
    project: {
      id: project.id,
      name: project.name,
      descriptionDocumentId: '',
      updatedAt: project.submittedAt,
      access: 'owner',
    },
    properties: project.properties.map(({ property, value }) =>
      withProjectPropertyValue(property, value)
    ),
    pending: project.phase === 'creating',
  };
}

const propertyOf = (row: ProjectRow, id: string) =>
  row.properties.find((property) => property.propertyDefinitionId === id);

function hasOption(row: ProjectRow, id: string, option: string | undefined) {
  if (!option) return true;
  const property = propertyOf(row, id);
  return (
    property?.valueType === 'SELECT_STRING' &&
    Boolean(property.value?.includes(option))
  );
}

function hasAssignee(row: ProjectRow, userId: string | undefined) {
  if (!userId) return true;
  const property = propertyOf(row, SYSTEM_PROPERTY_IDS.ASSIGNEES);
  return (
    property?.valueType === 'ENTITY' &&
    Boolean(
      property.value?.some(
        (ref) => ref.entity_type === 'USER' && ref.entity_id === userId
      )
    )
  );
}

function isDueWithin(row: ProjectRow, { dueAfter, dueBefore }: ProjectFilters) {
  if (!dueAfter && !dueBefore) return true;
  const property = propertyOf(row, SYSTEM_PROPERTY_IDS.DUE_DATE);
  if (property?.valueType !== 'DATE' || !property.value) return false;
  const due = property.value.getTime();
  return (
    (!dueAfter || due >= Date.parse(dueAfter)) &&
    (!dueBefore || due <= Date.parse(dueBefore))
  );
}

/** Mirrors the server's list filters so a pending row appears only where it will stay. */
function matchesProjectFilters(row: ProjectRow, filters: ProjectFilters) {
  return (
    (!filters.query ||
      row.project.name.toLowerCase().includes(filters.query.toLowerCase())) &&
    hasOption(row, SYSTEM_PROPERTY_IDS.STATUS, filters.status) &&
    hasOption(row, SYSTEM_PROPERTY_IDS.PRIORITY, filters.priority) &&
    hasAssignee(row, filters.assignee) &&
    isDueWithin(row, filters)
  );
}

/**
 * New projects lead the newest-first list. While being created or saved they
 * stand in for their server row, so a refresh mid-save neither duplicates the
 * row nor drops its drafted values. Once saved, they only fill in until the
 * refreshed list includes them.
 */
export function withPendingProjects(
  rows: readonly ProjectRow[],
  pending: readonly PendingProject[],
  filters: ProjectFilters
): readonly ProjectRow[] {
  const listed = new Set(rows.map((row) => row.project.id));
  const shown = pending
    .filter((project) => project.phase !== 'saved' || !listed.has(project.id))
    .map(pendingProjectRow)
    .filter((row) => matchesProjectFilters(row, filters));
  if (shown.length === 0) return rows;
  const ids = new Set(shown.map((row) => row.project.id));
  return [...shown, ...rows.filter((row) => !ids.has(row.project.id))];
}
