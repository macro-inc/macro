import { createQueryKeys } from '@lukemorales/query-key-factory';

export const crmKeys = createQueryKeys('crm', {
  lists: null,
  pipelines: (teamId: string | undefined) => [teamId],
  pipelineTable: (id: string) => [id],
  pipelineRows: (id: string) => [id],
  company: (companyId: string) => [companyId],
  contact: (contactId: string) => [contactId],
  contactByEmail: (teamId: string, email: string) => [teamId, email],
  quickAccessContacts: null,
});
