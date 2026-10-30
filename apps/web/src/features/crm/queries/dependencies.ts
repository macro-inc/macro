import { storageServiceClient } from '@service-storage/client';
import type { QueryClient } from '@tanstack/solid-query';
/** Concrete dependencies stay at the query adapter boundary. */
export type CrmQueryDependencies = {
  storage: typeof storageServiceClient;
  client: QueryClient;
  feedback: { success(message: string): void; failure(message: string): void };
};

export type CrmRecordDependencies = Pick<
  CrmQueryDependencies,
  'storage' | 'client'
>;

export function createCrmRecordDependencies(
  client: QueryClient
): CrmRecordDependencies {
  return { storage: storageServiceClient, client };
}

export function createCrmQueryDependencies(
  client: QueryClient,
  feedback: CrmQueryDependencies['feedback']
): CrmQueryDependencies {
  return { ...createCrmRecordDependencies(client), feedback };
}
