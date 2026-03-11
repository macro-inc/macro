import { refetchDocumentShareButtonResource } from '@core/component/TopBar/ShareButton';
import { invalidateDeletedItems } from '@queries/storage/deleted';
import { invalidateProjects } from '@queries/storage/projects';
import { invalidateUserQuota } from '@queries/auth';
import { refetchHistory } from '@queries/history/history';
import { invalidatePreview } from '@queries/preview';

export function refetchResources() {
  // TODO: fetch documents
  // refetchDocuments();
  invalidateUserQuota();
  refetchHistory();
  refetchProjectResources();
  invalidateDeletedItems();
  invalidatePreview();
}

export async function refetchProjectResources(_force = false) {
  await invalidateProjects();

  refetchDocumentShareButtonResource();
}
