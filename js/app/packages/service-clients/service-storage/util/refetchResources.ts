import { refetchDocumentShareButtonResource } from '@core/component/TopBar/ShareButton';
import { invalidateDeletedItems } from '@queries/storage/deleted';
import { invalidateProjects } from '@queries/storage/projects';
import { invalidateUserQuota } from '@queries/auth';
import { refetchHistory } from '@queries/history/history';
import { invalidatePreview } from '@queries/preview';

type RefetchResourcesOptions = {
  id?: string;
};

export function refetchResources(options?: RefetchResourcesOptions) {
  // TODO: fetch documents
  // refetchDocuments();
  invalidateUserQuota();
  refetchHistory();
  refetchProjectResources();
  invalidateDeletedItems();
  // TODO: consolidate where we rename items
  // and optimistically set the data using setPreviewData
  invalidatePreview(options?.id);
}

export async function refetchProjectResources(_force = false) {
  await invalidateProjects();

  refetchDocumentShareButtonResource();
}
