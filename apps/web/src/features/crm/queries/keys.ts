import { createQueryKeys } from '@lukemorales/query-key-factory';

export const crmKeys = createQueryKeys('crm', {
  emailPrivacy: (teamId: string | undefined, userId: string | undefined) => [
    teamId,
    userId,
  ],
  lists: null,
  pipelines: (teamId: string | undefined) => [teamId],
  pipelineTable: (id: string) => [id],
  stageRequirements: (id: string) => [id],
  pipelinePositions: (id: string, viewId: string | undefined) => [id, viewId],
  pipelineRows: (id: string) => [id],
  company: (companyId: string) => [companyId],
  contact: (contactId: string) => [contactId],
  contactByEmail: (teamId: string, email: string) => [teamId, email],
  quickAccessContacts: null,
  blockedDomains: null,
});
