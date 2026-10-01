import { storageServiceClient } from '@service-storage/client';
import { fetchCrmCompanyPreviews as fetchPreviews } from './queries/previews';
export function fetchCrmCompanyPreviews(ids: string[]) {
  return fetchPreviews((input) => storageServiceClient.getCompany(input), ids);
}
