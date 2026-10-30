import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryClient } from '@queries/client';
import type {
  MarketingCapabilities,
  MarketingRepository,
} from './context/contracts';
import { createContactQueries } from './queries/contacts';
import { createSequenceContentSession } from './queries/content-session';
import { createDatabaseMarketingRepository } from './queries/database-repository';
import { marketingQueryKey } from './queries/enrollments-query';
import { createGmailSequenceDelivery } from './queries/gmail-delivery';
import { MarketingWorkspaceView } from './views/marketing-workspace';

function createQueryRepository(
  userId: () => string | undefined
): MarketingRepository {
  const repository = createDatabaseMarketingRepository();
  // CRM cards refetch in the background; a sequence write never waits on them.
  const invalidate = () =>
    fireAndForget(
      queryClient.invalidateQueries({ queryKey: marketingQueryKey(userId()) }),
      'email-marketing'
    );
  return {
    async load() {
      // Writes need this repository's fresh row handles and table versions.
      const snapshot = await repository.load();
      queryClient.setQueryData(marketingQueryKey(userId()), snapshot);
      return snapshot;
    },
    async saveCampaign(value) {
      await repository.saveCampaign(value);
      invalidate();
    },
    async saveEnrollment(value) {
      await repository.saveEnrollment(value);
      invalidate();
    },
  };
}

export function EmailMarketing() {
  const userId = useUserId();
  const { openWithSplit } = useSplitLayout();
  const capabilities: MarketingCapabilities = {
    repository: createQueryRepository(userId),
    delivery: createGmailSequenceDelivery(),
    composition: { createSession: createSequenceContentSession },
    ...createContactQueries(userId),
    openContact(contact) {
      if (contact.crmContactId)
        openWithSplit(
          { type: 'contact', id: contact.crmContactId },
          { activate: true, preferNewSplit: true }
        );
    },
    openDatabase(id) {
      openWithSplit(
        { type: 'database', id },
        { activate: true, preferNewSplit: true }
      );
    },
  };
  return <MarketingWorkspaceView capabilities={capabilities} />;
}
