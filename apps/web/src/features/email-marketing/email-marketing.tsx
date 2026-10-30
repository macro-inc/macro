import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { queryClient } from '@queries/client';
import type {
  MarketingCapabilities,
  MarketingRepository,
} from './context/contracts';
import { createContactQueries } from './queries/contacts';
import { createDatabaseMarketingRepository } from './queries/database-repository';
import { createGmailSequenceDelivery } from './queries/gmail-delivery';
import { marketingKeys } from './queries/keys';
import { MarketingWorkspaceView } from './views/marketing-workspace';

/**
 * Every workspace action ends with a reload, which seeds the CRM cards'
 * cache once, instead of a refetch per record written.
 */
function createQueryRepository(
  userId: () => string | undefined
): MarketingRepository {
  const repository = createDatabaseMarketingRepository();
  return {
    ...repository,
    async load() {
      const snapshot = await repository.load();
      queryClient.setQueryData(
        marketingKeys.snapshot(userId()).queryKey,
        snapshot
      );
      return snapshot;
    },
  };
}

export function EmailMarketing() {
  const userId = useUserId();
  const { openWithSplit } = useSplitLayout();
  const open = (content: Parameters<typeof openWithSplit>[0]) =>
    openWithSplit(content, { activate: true, preferNewSplit: true });
  const capabilities: MarketingCapabilities = {
    repository: createQueryRepository(userId),
    delivery: createGmailSequenceDelivery(),
    ...createContactQueries(userId),
    openContact(contact) {
      if (contact.crmContactId)
        open({ type: 'contact', id: contact.crmContactId });
    },
    openDatabase(id) {
      open({ type: 'database', id });
    },
    openThread(threadId) {
      open({ type: 'email', id: threadId });
    },
  };
  return <MarketingWorkspaceView capabilities={capabilities} />;
}
