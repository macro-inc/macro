/** One of a contact's numbers: E.164, and where it came from. */
export type CrmContactPhone = {
  phone: string;
  source: 'manual' | 'csv' | 'call';
};

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
