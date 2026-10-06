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
