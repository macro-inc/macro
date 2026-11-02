import { fireAndForget } from '@core/util/fireAndForget';
import { invalidateUserQuota } from '@queries/auth';
import { refetchHistory } from '@queries/history/history';
import { invalidatePreview } from '@queries/preview';
import { refetchBlockSharePermissions } from '@queries/share/block-share-permissions';
import { invalidateDeletedItems } from '@queries/storage/deleted';
import { invalidateProjects } from '@queries/storage/projects';

export function refetchResources() {
  // TODO: fetch documents
  // refetchDocuments();
  fireAndForget(invalidateUserQuota(), 'refetch-resources');
  fireAndForget(refetchHistory(), 'refetch-resources');
  fireAndForget(refetchProjectResources(), 'refetch-resources');
  fireAndForget(invalidateDeletedItems(), 'refetch-resources');
  fireAndForget(invalidatePreview(), 'refetch-resources');
}

async function refetchProjectResources(_force = false) {
  await invalidateProjects();

  refetchBlockSharePermissions();
}
