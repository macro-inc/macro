import { createQueryKeys } from '@lukemorales/query-key-factory';

export const gtmInviteKeys = createQueryKeys('gtmInvite', {
  links: (mine: boolean) => [mine],
  publicLink: (token: string) => [token],
  offer: null,
});
