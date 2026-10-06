import { storageServiceClient } from '@service-storage/client';
import {
  fetchCrmContactPreviews as fetchContacts,
  fetchCrmCompanyPreviews as fetchPreviews,
} from './queries/previews';
export function fetchCrmCompanyPreviews(ids: string[]) {
  return fetchPreviews((input) => storageServiceClient.getCompany(input), ids);
}

export function fetchCrmContactPreviews(ids: string[]) {
  return fetchContacts((input) => storageServiceClient.getContact(input), ids);
}
