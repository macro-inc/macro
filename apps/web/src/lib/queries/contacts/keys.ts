import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ContactDirectoryRequest } from './directory';

export const contactsKeys = createQueryKeys('contacts', {
  all: null,
  window: (
    owner: string,
    userId: string,
    hostId: string,
    generation: number,
    request: ContactDirectoryRequest
  ) => [owner, userId, hostId, generation, request],
});
