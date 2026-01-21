import { refetchDocumentShareButtonResource } from '@core/component/TopBar/ShareButton';
import { invalidateDeletedItems } from '@queries/storage/deleted';
import { invalidateProjects } from '@queries/storage/projects';
import { invalidateUserQuota } from '@queries/auth';
import { refetchHistory } from '@queries/history/history';

type StorageServiceResource = 'documents' | 'history' | 'projects';
type RefetchResourcesOptions = {
  [key in StorageServiceResource]: {
    force?: boolean;
  };
};
export function refetchResources(options?: RefetchResourcesOptions) {
  if (!options) {
    // TODO: fetch documents
    // refetchDocuments();
    invalidateUserQuota();
    refetchHistory();
    refetchProjectResources();
    invalidateDeletedItems();
    return;
  }
}

export async function refetchProjectResources(_force = false) {
  await invalidateProjects();

  refetchDocumentShareButtonResource();
}
