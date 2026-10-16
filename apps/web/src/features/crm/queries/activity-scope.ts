import type { CrmActivityScope } from './activity-filter';

type Company = { id: string; domains: { domain: string }[] };
type Contact = { id: string; email: string };
type ContactPage = { contacts: Contact[]; nextCursor: string | null };

/** Read every authorized record before constructing an association filter. */
export async function loadCrmActivityScope(
  sources: {
    companies(): Promise<Company[]>;
    contacts(cursor: string | null): Promise<ContactPage>;
  },
  signal: AbortSignal
): Promise<CrmActivityScope> {
  async function contacts() {
    const records = new Map<string, Contact>();
    const cursors: string[] = [];
    let cursor: string | null = null;
    do {
      signal.throwIfAborted();
      const page = await sources.contacts(cursor);
      signal.throwIfAborted();
      for (const contact of page.contacts) records.set(contact.id, contact);
      cursor = page.nextCursor;
      if (cursor && cursors.includes(cursor)) {
        throw new Error('CRM pagination did not advance.');
      }
      if (cursor) cursors.push(cursor);
    } while (cursor);
    return [...records.values()];
  }
  const [companies, people] = await Promise.all([
    sources.companies(),
    contacts(),
  ]);
  signal.throwIfAborted();
  const domains = [
    ...new Set(
      companies.flatMap((company) =>
        company.domains.map(({ domain }) => domain.toLowerCase())
      )
    ),
  ];
  const domainSet = new Set(domains);
  // A domain already matches every contact at that domain in every direction.
  // Omitting those redundant addresses keeps the email AST much smaller.
  const emails = [
    ...new Set(people.map(({ email }) => email.toLowerCase())),
  ].filter((email) => !domainSet.has(email.slice(email.lastIndexOf('@') + 1)));
  return {
    companyIds: companies.map((company) => company.id),
    contactIds: people.map((contact) => contact.id),
    domains,
    emails,
  };
}
