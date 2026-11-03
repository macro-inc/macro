import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ContactDirectoryRequest } from './directory';
import type { ContactLookup } from './lookup';
import type { ContactReferenceRequest } from './references';

export const contactsKeys = createQueryKeys('contacts', {
  all: null,
  references: (
    owner: string,
    userId: string,
    hostId: string,
    epoch: number,
    request: ContactReferenceRequest
  ) => [owner, userId, hostId, epoch, request],
  resolution: (
    owner: string,
    userId: string,
    hostId: string,
    epoch: number,
    lookup: ContactLookup
  ) => [owner, userId, hostId, epoch, lookup],
  window: (
    owner: string,
    userId: string,
    hostId: string,
    generation: number,
    request: ContactDirectoryRequest
  ) => [owner, userId, hostId, generation, request],
});
