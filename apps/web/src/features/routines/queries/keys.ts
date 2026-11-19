import { createQueryKeys } from '@lukemorales/query-key-factory';

export const scheduledActionKeys = createQueryKeys('scheduledAction', {
  all: null,
  list: null,
  /** Every active routine another routine's run created. */
  subRoutines: null,
  /** The caller's background drafts: drafting, ready and failed. */
  draftJobs: null,
  /** What one routine's runs created, finished one-time ones included. */
  children: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId],
  }),
  catalog: (params: { timezone: string }) => ({
    queryKey: [params.timezone],
  }),
  detail: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId],
  }),
  history: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId, 'history'],
  }),
  codeUpgrades: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId, 'code-upgrades'],
  }),
  /** Its knobs whose picked item its owner can't use now. */
  unusableItems: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId, 'unusable-items'],
  }),
  template: (params: { scheduleId: string }) => ({
    queryKey: [params.scheduleId, 'template'],
  }),
  referenceAccess: (params: { itemId: string; itemType: string }) => ({
    queryKey: [params.itemId, params.itemType],
  }),
});
