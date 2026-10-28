import { createQueryKeys } from '@lukemorales/query-key-factory';

export const harnessKeys = createQueryKeys('harnesses', {
  list: null,
  pairing: (code: string) => [code],
});
