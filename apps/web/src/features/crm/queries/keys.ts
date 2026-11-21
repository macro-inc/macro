import { createQueryKeys } from '@lukemorales/query-key-factory';

export const crmKeys = createQueryKeys('crm', {
  emailPolicy: (scope: string | undefined) => [scope],
  emailPolicyHistory: (scope: string | undefined, before?: string) => [
    scope,
    before,
  ],
  emailPolicyRevision: (scope: string | undefined, revision: number) => [
    scope,
    revision,
  ],
  emailPolicyPreview: (scope: string | undefined) => [scope],
  emailPrivacy: (teamId: string | undefined, userId: string | undefined) => [
    teamId,
    userId,
  ],
  excludedEmailThreads: (
    teamId: string | undefined,
    userId: string | undefined,
    session: number | undefined,
    after: string | undefined,
    threadId?: string
  ) => [teamId, userId, session, after, threadId],
  emailConsent: (
    teamId: string | undefined,
    userId: string | undefined,
    session: number | undefined
  ) => [teamId, userId, session],
  // One `/saved_views` read serves CRM lists and personal views.
  savedViews: null,
  pipelines: (teamId: string | undefined) => [teamId],
  pipelineTable: (id: string) => [id],
  stageRequirements: (id: string) => [id],
  pipelinePositions: (id: string, viewId: string | undefined) => [id, viewId],
  pipelineRows: (id: string) => [id],
  company: (companyId: string) => [companyId],
  // A company's Team list pages; the archive state and search follow the id.
  companyContacts: (companyId: string) => [companyId],
  contact: (contactId: string) => [contactId],
  contactByEmail: (teamId: string, email: string) => [teamId, email],
  quickAccessContacts: null,
  blockedDomains: null,
});
