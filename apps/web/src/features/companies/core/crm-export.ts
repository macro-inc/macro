import type { CrmCompanyEntity } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { CrmPerson } from './crm-people';

export type ExportColumn = { id: string; label: string; default?: boolean };
export const COMPANY_EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'name', label: 'Company', default: true },
  { id: 'domains', label: 'Domains', default: true },
  { id: 'stage', label: 'Stage', default: true },
  { id: 'owner', label: 'Owner', default: true },
  {
    id: `property:${SYSTEM_PROPERTY_IDS.REVENUE}`,
    label: 'Revenue',
    default: true,
  },
  { id: 'lastInteraction', label: 'Last interaction', default: true },
  { id: 'firstInteraction', label: 'First interaction' },
  { id: 'description', label: 'Description' },
  { id: 'emailSync', label: 'Email sync' },
  { id: 'id', label: 'Company ID' },
];
export const PEOPLE_EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'name', label: 'Name', default: true },
  { id: 'email', label: 'Email', default: true },
  { id: 'companyName', label: 'Company', default: true },
  { id: 'lastInteraction', label: 'Last contacted', default: true },
  { id: 'firstInteraction', label: 'First contact', default: true },
  { id: 'createdAt', label: 'Date added' },
  { id: 'id', label: 'Contact ID' },
  { id: 'companyId', label: 'Company ID' },
];
export type ExportRecord = Record<
  string,
  string | number | boolean | null | undefined
>;

/** Quote RFC 4180 fields and neutralize spreadsheet formulas in text values. */
export function createCrmCsv(columns: ExportColumn[], rows: ExportRecord[]) {
  const cell = (value: ExportRecord[string]) => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text))
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      columns.map((column) => cell(column.label)).join(','),
      ...rows.map((row) =>
        columns.map((column) => cell(row[column.id])).join(',')
      ),
    ].join('\r\n') +
    '\r\n'
  );
}

export function companyExportRecord(
  company: CrmCompanyEntity,
  stage: string,
  owner: string,
  propertyValue: (
    property: NonNullable<CrmCompanyEntity['properties']>[number]
  ) => string | number | boolean
): ExportRecord {
  return {
    id: company.id,
    name: company.name,
    domains: company.domains.map((domain) => domain.domain).join('; '),
    stage,
    owner,
    lastInteraction: String(company.updatedAt ?? ''),
    firstInteraction: String(company.createdAt ?? ''),
    description: company.description,
    emailSync: company.emailSync,
    ...Object.fromEntries(
      (company.properties ?? []).map((property) => [
        `property:${property.definition.id}`,
        propertyValue(property),
      ])
    ),
  };
}
export function personExportRecord(person: CrmPerson): ExportRecord {
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    companyName: person.companyName,
    companyId: person.companyId,
    firstInteraction: person.firstInteraction,
    lastInteraction: person.lastInteraction,
    createdAt: person.createdAt,
  };
}
