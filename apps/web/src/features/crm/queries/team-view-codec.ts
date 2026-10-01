import type { TeamCrmSavedView } from '../core/team-config';
/** Team settings are JSON; keep only records with the shape required by saved-view controls. */
export function parseTeamViews(value: unknown): TeamCrmSavedView[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is TeamCrmSavedView =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      'config' in item &&
      (item.createdBy === undefined || typeof item.createdBy === 'string') &&
      (item.createdAt === undefined || typeof item.createdAt === 'string')
  );
}
