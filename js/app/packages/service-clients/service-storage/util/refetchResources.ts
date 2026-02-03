import { refetchDocumentShareButtonResource } from '@core/component/TopBar/ShareButton';
import { invalidateDeletedItems } from '@queries/storage/deleted';
import { invalidateProjects } from '@queries/storage/projects';
import { invalidateUserQuota } from '@queries/auth';
import { refetchHistory } from '@queries/history/history';
import { invalidatePreview } from '@queries/preview';
import { invalidateChannelWithID } from '@queries/channel/channel';
import { invalidateListChannels } from '@queries/channel/channels';

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
  if (options?.id) {
    invalidateChannelWithID(options.id);
    invalidateListChannels();
  }
}

export async function refetchProjectResources(_force = false) {
  await invalidateProjects();

  refetchDocumentShareButtonResource();
}
