import { storageServiceClient } from '@service-storage/client';
import {
  fetchCrmPipelinePreviews as fetchPipelines,
  fetchCrmRecordPreviews as fetchRecords,
} from './queries/previews';

/** Company and contact chips of one preview batch, in one request. */
export function fetchCrmRecordPreviews(
  companyIds: string[],
  contactIds: string[]
) {
  return fetchRecords(
    (body) => storageServiceClient.previewCrmRecords(body),
    companyIds,
    contactIds
  );
}

export function fetchCrmPipelinePreviews(ids: string[]) {
  return fetchPipelines((id) => storageServiceClient.getCrmPipeline(id), ids);
}
