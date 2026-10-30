import {
  fetchCompany,
  fetchContact,
  fetchCrmPipeline,
} from '@queries/storage/requests';
import {
  fetchCrmContactPreviews as fetchContacts,
  fetchCrmPipelinePreviews as fetchPipelines,
  fetchCrmCompanyPreviews as fetchPreviews,
} from './queries/previews';
export function fetchCrmCompanyPreviews(ids: string[]) {
  return fetchPreviews(fetchCompany, ids);
}

export function fetchCrmContactPreviews(ids: string[]) {
  return fetchContacts(fetchContact, ids);
}

export function fetchCrmPipelinePreviews(ids: string[]) {
  return fetchPipelines(fetchCrmPipeline, ids);
}
