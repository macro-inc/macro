/** CRM contact values, independent of the transport schema. */
export type CrmContact = {
  id: string;
  /** Absent for a contact without a company. */
  companyId?: string | null;
  name?: string | null;
  /** The primary address; absent for a contact added by name alone. */
  email?: string | null;
  /** Every address, primary first; absent until the contact detail is loaded. */
  emails?: string[];
  /** Server classification; absent until the contact detail is loaded. */
  personalEmail?: boolean;
  /** Whether an address on the company's domain ties the contact to it. */
  companyDomain?: boolean;
  /** The addresses on the company's domain; the last one cannot be removed. */
  companyDomainEmails?: string[];
  /**
   * The company's name and visibility, sent with the contact detail. Older
   * servers and mutation responses omit it; read it through
   * `contactCompanySummary`, which also drops a summary of a former company.
   */
  company?: CrmContactCompany | null;
  hidden: boolean;
  firstInteraction: string;
  lastInteraction: string;
  createdAt: string;
  updatedAt: string;
};

/** What a contact detail says about its company. */
export type CrmContactCompany = {
  id: string;
  name?: string | null;
  /** The oldest domain, shown when the company has no name. */
  domain?: string | null;
  hidden: boolean;
};

/** The company name a contact shows, as the company read would show it. */
export function contactCompanyName(company: CrmContactCompany): string {
  return company.name ?? company.domain ?? '';
}

/**
 * The contact's company summary, when the contact carries one for its
 * current company. Undefined means the company itself has to be read.
 */
export function contactCompanySummary(
  contact: Pick<CrmContact, 'companyId' | 'company'> | undefined
): CrmContactCompany | undefined {
  const company = contact?.company;
  if (!company || !contact.companyId || company.id !== contact.companyId)
    return undefined;
  return company;
}

/** What an email edit does with the address it names. */
export type ContactEmailChange = 'add' | 'remove' | 'primary';

/** Every address of a contact, primary first, whichever source loaded it. */
export function contactEmails(
  contact: Pick<CrmContact, 'email' | 'emails'>
): string[] {
  if (contact.emails) return contact.emails;
  return contact.email ? [contact.email] : [];
}
