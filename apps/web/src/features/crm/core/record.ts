/** Identity of a company or contact, independent of its loaded details. */
export type CrmRecordTarget = { type: 'company' | 'contact'; id: string };
/** Record identity and already-loaded associations for a new task. */
export type CrmTaskRecord =
  | { type: 'company'; id: string }
  | { type: 'contact'; id: string; companyId?: string };
/** A CRM record whose associated files, tasks and calls a record tab lists. */
export type CrmRecordScope =
  | { type: 'company'; id: string; domains: string[] }
  | { type: 'contact'; id: string; email: string; companyId: string };

/**
 * Whether two scopes describe the same record. Record views keep their
 * scope while a refetch changes nothing, so tabs keyed on it stay mounted.
 */
export function sameRecordScope(
  a: CrmRecordScope | undefined,
  b: CrmRecordScope | undefined
): boolean {
  if (!a || !b) return a === b;
  if (a.type === 'company' && b.type === 'company') {
    return a.id === b.id && a.domains.join('\n') === b.domains.join('\n');
  }
  if (a.type === 'contact' && b.type === 'contact') {
    return a.id === b.id && a.email === b.email && a.companyId === b.companyId;
  }
  return false;
}

/** A CRM record shown inside the workspace, with its fallback label. */
export type CrmRecordRef = {
  type: 'company' | 'contact';
  id: string;
  name: string;
};

/** Tabs of a CRM record, in display order per record type. */
export const COMPANY_SECTIONS = [
  'overview',
  'team',
  'emails',
  'files',
  'tasks',
  'calls',
] as const;
export const CONTACT_SECTIONS = [
  'overview',
  'emails',
  'files',
  'tasks',
  'calls',
] as const;

export type CompanySection = (typeof COMPANY_SECTIONS)[number];
export type ContactSection = (typeof CONTACT_SECTIONS)[number];
export type CrmRecordSection = CompanySection | ContactSection;

export const CRM_RECORD_SECTION_LABELS: Record<CrmRecordSection, string> = {
  overview: 'Overview',
  team: 'Team',
  emails: 'Emails',
  files: 'Files',
  tasks: 'Tasks',
  calls: 'Calls',
};
