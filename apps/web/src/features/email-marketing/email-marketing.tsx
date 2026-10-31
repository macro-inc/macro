import { useBeforeLeave } from '@app/lib/split-router';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import type {
  MarketingCapabilities,
  MarketingRepository,
} from './context/contracts';
import { createContactQueries } from './queries/contacts';
import { createDatabaseMarketingRepository } from './queries/database-repository';
import { seedMarketingSnapshot } from './queries/enrollments-query';
import { createGmailSequenceDelivery } from './queries/gmail-delivery';
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
      seedMarketingSnapshot(userId(), snapshot);
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
  // Leaving the module saves open edits the way leaving a campaign does.
  let leave: (() => Promise<boolean>) | undefined;
  useBeforeLeave(() => leave?.() ?? true);
  return (
    <MarketingWorkspaceView
      capabilities={capabilities}
      registerLeave={(guard) => {
        leave = guard;
      }}
    />
  );
}
