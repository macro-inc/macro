import { createQueryKeys } from '@lukemorales/query-key-factory';

export const computerKeys = createQueryKeys('computers', {
  list: null,
  offers: null,
  rollout: null,
  usage: null,
  claudeMode: (harnessId: string) => [harnessId],
});
