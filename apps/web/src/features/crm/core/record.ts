/** A CRM record whose associated files, tasks and calls a record tab lists. */
export type CrmRecordScope =
  | { type: 'company'; id: string; domains: string[] }
  | { type: 'contact'; id: string; email: string };

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
