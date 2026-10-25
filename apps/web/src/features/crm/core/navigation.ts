/** The record types the CRM sidebar lists; ids are workspace tabs. */
export const CRM_RECORDS = [
  { id: 'active', label: 'Companies' },
  { id: 'people', label: 'People' },
] as const;

/** Workspace feeds scoped to CRM-linked content, rather than one record. */
export const CRM_ACTIVITY_TABS = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'email', label: 'Email' },
  { id: 'notes', label: 'Notes' },
  { id: 'calls', label: 'Calls' },
] as const;

export type CrmActivityTab = (typeof CRM_ACTIVITY_TABS)[number]['id'];

export function isCrmActivityTab(value: string): value is CrmActivityTab {
  return CRM_ACTIVITY_TABS.some((tab) => tab.id === value);
}
const PIPELINE_TAB_PREFIX = 'pipeline:';

/** The workspace tab that shows a pipeline. */
export function pipelineTab(pipelineId: string): string {
  return `${PIPELINE_TAB_PREFIX}${pipelineId}`;
}

/** The pipeline a workspace tab shows, if any. */
export function pipelineIdOfTab(tab: string | undefined): string | undefined {
  return tab?.startsWith(PIPELINE_TAB_PREFIX)
    ? tab.slice(PIPELINE_TAB_PREFIX.length)
    : undefined;
}

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
