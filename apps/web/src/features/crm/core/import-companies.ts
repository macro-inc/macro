import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';

export type CompanyImportRow = { name: string; domain: string };

/** Rows to create, and how many the file had without a new, usable domain. */
export type CompanyImport = { rows: CompanyImportRow[]; skipped: number };

export type CompanyImportFailure =
  | { kind: 'no-domain-column' }
  | { kind: 'no-companies' }
  | { kind: 'too-many-rows' };

const MAX_COMPANY_IMPORT_ROWS = 10_000;

// Our own export writes `Company` and `Domains`.
const NAME_HEADERS = ['name', 'company', 'company name'];
const DOMAIN_HEADERS = ['domain', 'domains', 'website'];
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** A CSV cell as typed, without the quote CSV exports put before formula characters. */
export function importedText(value: string | undefined): string {
  const text = (value ?? '').trim();
  // Exports quote values that start with one after spaces too.
  return /^'\s*[=+\-@]/.test(text) ? text.slice(1).trim() : text;
}

/** The bare domain of a domain, URL, or email address. */
export function importedDomain(value: string): string | undefined {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^@/]*@/, '')
    .replace(/^www\./, '')
    .split(/[/?#:]/)[0];
  return host && DOMAIN.test(host) ? host : undefined;
}

export function companyImportMessage(failure: CompanyImportFailure): string {
  return match(failure)
    .with(
      { kind: 'no-domain-column' },
      () => 'Include a Domain column, with domains like acme.com.'
    )
    .with(
      { kind: 'no-companies' },
      () => 'No rows have a domain like acme.com.'
    )
    .with(
      { kind: 'too-many-rows' },
      () =>
        `Import up to ${MAX_COMPANY_IMPORT_ROWS.toLocaleString('en-US')} companies at a time.`
    )
    .exhaustive();
}

/**
 * Companies from CSV records keyed by header, including a CRM export. A row
 * takes its first valid domain, and its name defaults to that domain.
 */
export function normalizeCompanyImport(
  records: readonly Record<string, string>[]
): Result<CompanyImport, CompanyImportFailure> {
  if (records.length > MAX_COMPANY_IMPORT_ROWS)
    return err({ kind: 'too-many-rows' });
  const headers = Object.keys(records[0] ?? {});
  const header = (names: string[]) =>
    headers.find((key) => names.includes(key.trim().toLowerCase()));
  const nameHeader = header(NAME_HEADERS);
  const domainHeader = header(DOMAIN_HEADERS);
  if (!domainHeader) return err({ kind: 'no-domain-column' });
  const seen = new Set<string>();
  const rows: CompanyImportRow[] = [];
  for (const record of records) {
    const domain = importedText(record[domainHeader])
      .split(/[;,\s]+/)
      .map(importedDomain)
      .find((domain) => domain !== undefined);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    rows.push({
      name: (nameHeader && importedText(record[nameHeader])) || domain,
      domain,
    });
  }
  if (!rows.length) return err({ kind: 'no-companies' });
  return ok({ rows, skipped: records.length - rows.length });
}
