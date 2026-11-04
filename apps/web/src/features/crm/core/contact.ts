/** CRM contact values, independent of the transport schema. */
export type CrmContact = {
  id: string;
  /** Absent for a contact without a company. */
  companyId?: string | null;
  name?: string | null;
  /** Absent for a contact added by name alone. */
  email?: string | null;
  hidden: boolean;
  firstInteraction: string;
  lastInteraction: string;
  createdAt: string;
  updatedAt: string;
};
