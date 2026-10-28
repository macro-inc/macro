import type { Pipeline } from './pipeline';

// Light client-side check for a bare domain like "acme.com"; the server
// enforces the real rules (no scheme/path/@, not a generic email provider).
const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+)$/;

export const isCompanyDomain = (value: string) => DOMAIN_PATTERN.test(value);

/** A company or contact someone can pick for a pipeline row. */
export type RecordOption = { id: string; name: string; detail: string };

/** The detail worth showing beside a record's name: none when it only repeats the name. */
export const recordDetail = (record: RecordOption) =>
  record.detail.trim().toLowerCase() === record.name.trim().toLowerCase()
    ? ''
    : record.detail;

/** A company a new contact can join, by the domain of its email. */
export type DomainCompany = { id: string; domain: string };

/** Whom a new pipeline row is about: a record that exists, or one created with the row. */
export type RecordChoice =
  | { kind: 'existing'; record: RecordOption }
  | { kind: 'new-company'; name: string; domain: string }
  | { kind: 'new-contact'; name: string; email: string };

/** A new record seeded from what was searched: a domain or email goes in its field, anything else is the name. */
export function newRecordChoice(
  recordType: Pipeline['recordType'],
  search: string
): RecordChoice {
  const query = search.trim();
  if (recordType === 'company') {
    const domain = query.toLowerCase();
    if (!isCompanyDomain(domain))
      return { kind: 'new-company', name: query, domain: '' };
    const label = domain.split('.')[0];
    return {
      kind: 'new-company',
      name: label.charAt(0).toUpperCase() + label.slice(1),
      domain,
    };
  }
  return query.includes('@')
    ? { kind: 'new-contact', name: '', email: query.toLowerCase() }
    : { kind: 'new-contact', name: query, email: '' };
}

/** The company whose domain a contact's email uses. */
export function contactCompany(
  email: string,
  companies: readonly DomainCompany[]
): DomainCompany | undefined {
  const domain = EMAIL_PATTERN.exec(email.trim().toLowerCase())?.[1];
  return domain
    ? companies.find((company) => company.domain.toLowerCase() === domain)
    : undefined;
}

/** Why the record cannot be saved as entered, or nothing when it can. */
export function recordChoiceProblem(
  choice: RecordChoice,
  companies: readonly DomainCompany[]
): string | undefined {
  if (choice.kind === 'existing') return undefined;
  if (!choice.name.trim())
    return choice.kind === 'new-company'
      ? 'Enter a company name'
      : 'Enter a name';
  if (choice.kind === 'new-company')
    return isCompanyDomain(choice.domain.trim())
      ? undefined
      : 'Enter a valid domain like acme.com';
  const email = choice.email.trim();
  const domain = EMAIL_PATTERN.exec(email)?.[1];
  if (!domain) return 'Enter an email like jane@acme.com';
  return contactCompany(email, companies)
    ? undefined
    : `No company uses ${domain.toLowerCase()}. Add the company first.`;
}
