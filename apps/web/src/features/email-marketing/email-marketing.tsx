import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { queryClient } from '@queries/client';
import { useQuery } from '@tanstack/solid-query';
import type {
  MarketingCapabilities,
  MarketingRepository,
} from './context/contracts';
import { createContactQueries } from './queries/contacts';
import { createSequenceContentSession } from './queries/content-session';
import { createDatabaseMarketingRepository } from './queries/database-repository';
import { createGmailSequenceDelivery } from './queries/gmail-delivery';
import { MarketingWorkspaceView } from './views/marketing-workspace';

export const marketingQueryKey = (userId: string | undefined) =>
  ['email-marketing', userId ?? 'signed-out'] as const;

function createQueryRepository(
  userId: () => string | undefined
): MarketingRepository {
  const repository = createDatabaseMarketingRepository();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: marketingQueryKey(userId()) });
  return {
    async load() {
      // Writes need this repository's fresh row handles and table versions.
      const snapshot = await repository.load();
      queryClient.setQueryData(marketingQueryKey(userId()), snapshot);
      return snapshot;
    },
    async saveCampaign(value) {
      await repository.saveCampaign(value);
      await invalidate();
    },
    async saveEnrollment(value) {
      await repository.saveEnrollment(value);
      await invalidate();
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

/** Shared query shape for CRM, scoped to the signed-in account. */
export function useMarketingEnrollments() {
  const userId = useUserId();
  const repository = createDatabaseMarketingRepository();
  return useQuery(() => ({
    queryKey: marketingQueryKey(userId()),
    queryFn: () => repository.load(),
    enabled: !!userId(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  }));
}
