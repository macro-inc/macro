export const CRM_VIEWS = [
  {
    id: 'active',
    label: 'All companies',
    description: 'Every visible company in your CRM',
  },
  {
    id: 'my-companies',
    label: 'My companies',
    description: 'Companies assigned to you',
  },
  {
    id: 'needs-follow-up',
    label: 'Needs follow-up',
    description:
      'Has a stage other than Churned, with no interaction in the last 14 days',
  },
  {
    id: 'recently-active',
    label: 'Recently active',
    description:
      'Team email activity in the last 7 days. Newly added companies may also appear.',
  },
  {
    id: 'unassigned',
    label: 'Unassigned',
    description: 'Companies without an owner',
  },
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
