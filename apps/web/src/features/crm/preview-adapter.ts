import { fireAndForget } from '@core/util/fireAndForget';
import { storageServiceClient } from '@service-storage/client';
import { forgetMergedCrmRecords } from '@service-storage/crm-record-merge';
import {
  fetchCrmPipelinePreviews as fetchPipelines,
  fetchCrmRecordPreviews as fetchRecords,
} from './queries/previews';

/** Company and contact chips of one preview batch, in one request. */
export async function fetchCrmRecordPreviews(
  companyIds: string[],
  contactIds: string[]
) {
  const previews = await fetchRecords(
    (body) => storageServiceClient.previewCrmRecords(body),
    companyIds,
    contactIds
  );
  fireAndForget(forgetMergedCrmRecords(previews.merged), 'crm');
  return previews;
}

export function fetchCrmPipelinePreviews(ids: string[]) {
  return fetchPipelines((id) => storageServiceClient.getCrmPipeline(id), ids);
}
