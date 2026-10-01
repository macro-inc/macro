import { createQueryKeys } from '@lukemorales/query-key-factory';

export const crmKeys = createQueryKeys('crm', {
  lists: null,
  company: (companyId: string) => [companyId],
  contact: (contactId: string) => [contactId],
  contactByEmail: (teamId: string, email: string) => [teamId, email],
});
