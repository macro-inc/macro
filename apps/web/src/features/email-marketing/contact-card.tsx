import { useSplitLayout } from '@components/app/split-layout/layout';
import { ContactEnrollments } from './components/contact-enrollments';
import { normalizeEmail } from './core/model';
import { useMarketingEnrollments } from './queries/enrollments-query';

export function MarketingContactCard(props: { email: string }) {
  const query = useMarketingEnrollments();
  const { openWithSplit } = useSplitLayout();
  return (
    <ContactEnrollments
      entries={
        // Keep cached rows through a failed refetch (FE-48).
        query.data?.enrollments.filter(
          (entry) =>
            normalizeEmail(entry.contact.email) === normalizeEmail(props.email)
        ) ?? []
      }
      loading={query.isPending}
      error={
        query.isError && !query.data
          ? 'Could not load Email Marketing enrollments.'
          : undefined
      }
      onOpen={() =>
        openWithSplit(
          { type: 'component', id: 'email-marketing' },
          { activate: true, preferNewSplit: true }
        )
      }
    />
  );
}
