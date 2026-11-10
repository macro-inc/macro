import { createQueryKeys } from '@lukemorales/query-key-factory';

export const harnessKeys = createQueryKeys('harnesses', {
  list: null,
  directory: null,
  residents: (harnessId: string) => [harnessId],
  pairing: (code: string) => [code],
});
