/** One of a contact's numbers: E.164, and where it came from. */
export type CrmContactPhone = {
  phone: string;
  source: 'manual' | 'csv' | 'call';
};

/**
 * A stored E.164 number for people to read. North American numbers are
 * grouped as `+1 NNN-NNN-NNNN`; others stay as stored, since their grouping
 * varies by country. Matches the backend's `PhoneNumber::readable`.
 */
export function readablePhone(e164: string): string {
  const digits = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return digits ? `+1 ${digits[1]}-${digits[2]}-${digits[3]}` : e164;
}

/** CRM contact values, independent of the transport schema. */
export type CrmContact = {
  id: string;
  /** Absent for a contact without a company. */
  companyId?: string | null;
  name?: string | null;
  /** Absent for a contact added by name alone. */
  email?: string | null;
  /** Server classification; absent until the contact detail is loaded. */
  personalEmail?: boolean;
  hidden: boolean;
  firstInteraction: string;
  lastInteraction: string;
  createdAt: string;
  updatedAt: string;
};
