/** CRM contact values, independent of the transport schema. */
export type CrmContact = {
  id: string;
  companyId: string;
  name?: string | null;
  email: string;
  hidden: boolean;
  firstInteraction: string;
  lastInteraction: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * The email a legacy contact id addresses, or undefined for a CRM contact id.
 * Legacy contact chips and `/app/contact/<email>` links name a person by
 * email, sometimes still percent-encoded; CRM contacts are named by UUID.
 */
export function legacyContactEmail(contactId: string): string | undefined {
  let value = contactId;
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return;
    }
  }
  value = value.trim().toLowerCase();
  const at = value.indexOf('@');
  return at > 0 && at < value.length - 1 ? value : undefined;
}
