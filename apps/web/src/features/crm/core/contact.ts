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
  hidden: boolean;
  firstInteraction: string;
  lastInteraction: string;
  createdAt: string;
  updatedAt: string;
};

/** Every address of a contact, primary first, whichever source loaded it. */
export function contactEmails(
  contact: Pick<CrmContact, 'email' | 'emails'>
): string[] {
  if (contact.emails) return contact.emails;
  return contact.email ? [contact.email] : [];
}
