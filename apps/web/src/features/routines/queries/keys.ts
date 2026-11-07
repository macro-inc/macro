import { createQueryKeys } from '@lukemorales/query-key-factory';

export const scheduledActionKeys = createQueryKeys('scheduledAction', {
  all: null,
  list: null,
  starters: null,
  detail: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId],
  }),
  history: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId, 'history'],
  }),
  codeUpgrades: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId, 'code-upgrades'],
  }),
  template: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId, 'template'],
  }),
  webhook: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId, 'webhook'],
  }),
  referenceAccess: (params: { itemId: string; itemType: string }) => ({
    queryKey: [params.itemId, params.itemType],
  }),
});
