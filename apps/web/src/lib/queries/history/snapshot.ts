import { syncServiceClient } from '@service-sync/client';

export const fetchDocumentSnapshot: typeof syncServiceClient.getSnapshot = (
  ...args
) => syncServiceClient.getSnapshot(...args);
