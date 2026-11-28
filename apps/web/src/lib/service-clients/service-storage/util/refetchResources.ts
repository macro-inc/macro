import { refetchDocumentShareButtonResource } from '@core/component/TopBar/ShareButton';
import { fireAndForget } from '@core/util/fireAndForget';
import { invalidateUserQuota } from '@queries/auth';
import { refetchHistory } from '@queries/history/history';
import { invalidatePreview } from '@queries/preview';
import { invalidateDeletedItems } from '@queries/storage/deleted';
import { refreshActiveGraphqlFoldersQueries } from '@queries/storage/graphql-folders';

export function refetchResources({ refreshFolders = true } = {}) {
  // TODO: fetch documents
  // refetchDocuments();
  fireAndForget(invalidateUserQuota(), 'refetch-resources');
  fireAndForget(refetchHistory(), 'refetch-resources');
  fireAndForget(refetchProjectResources(refreshFolders), 'refetch-resources');
  fireAndForget(invalidateDeletedItems(), 'refetch-resources');
  fireAndForget(invalidatePreview(), 'refetch-resources');
}

async function refetchProjectResources(refreshFolders: boolean) {
  if (refreshFolders) await refreshActiveGraphqlFoldersQueries();

  refetchDocumentShareButtonResource();
}
