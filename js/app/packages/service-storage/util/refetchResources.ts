import { refetchDocumentFileMenuResource } from '@core/component/TopBar/FileMenu';
import { refetchDocumentShareButtonResource } from '@core/component/TopBar/ShareButton';
import { invalidateUserQuota } from '@service-auth/userQuota';
import { refetchDeletedItems } from '@service-storage/deleted';
import { refetchHistory } from '@service-storage/history';
import { refetchPins } from '@service-storage/pins';
import { refetchProjects } from '@service-storage/projects';

type StorageServiceResource = 'documents' | 'history' | 'pins' | 'projects';
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
    refetchPins();
    refetchProjectResources();
    refetchDeletedItems();
    return;
  }
}

export async function refetchProjectResources(force = false) {
  await refetchProjects(force);

  refetchDocumentFileMenuResource();
  refetchDocumentShareButtonResource();
}
