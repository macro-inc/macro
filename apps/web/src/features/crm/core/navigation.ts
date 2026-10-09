/** The record types the CRM sidebar lists; ids are workspace tabs. */
export const CRM_RECORDS = [
  { id: 'active', label: 'Companies' },
  { id: 'people', label: 'People' },
] as const;

export type CrmListConfig = {
  kind: 'crm-list';
  teamId: string;
  companyIds: string[];
};

export function isCrmListConfig(value: unknown): value is CrmListConfig {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'kind' in value &&
    value.kind === 'crm-list' &&
    'teamId' in value &&
    typeof value.teamId === 'string' &&
    'companyIds' in value &&
    Array.isArray(value.companyIds) &&
    value.companyIds.every((id: unknown) => typeof id === 'string')
  );
}

export function matchesInteractionWindow(
  updatedAt: string | Date | null | undefined,
  view: 'needs-follow-up' | 'recently-active',
  now = Date.now()
) {
  if (!updatedAt) return view === 'needs-follow-up';
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return view === 'needs-follow-up'
    ? age >= 14 * 86400000
    : age >= 0 && age <= 7 * 86400000;
}

export function needsCompanyFollowUp(
  updatedAt: string | Date | null | undefined,
  stageLabel: string | undefined,
  now = Date.now()
) {
  const stage = stageLabel?.trim().toLowerCase();
  return (
    !!stage &&
    stage !== 'churned' &&
    matchesInteractionWindow(updatedAt, 'needs-follow-up', now)
  );
}
