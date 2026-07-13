import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { CrmCommentEntityType } from '@service-storage/generated/schemas/crmCommentEntityType';

export const crmKeys = createQueryKeys('crm', {
  company: (companyId: string) => [companyId],
  contact: (contactId: string) => [contactId],
  comments: (entityType: CrmCommentEntityType, entityId: string) => [
    entityType,
    entityId,
  ],
});
