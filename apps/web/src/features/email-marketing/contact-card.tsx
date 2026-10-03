import { useSplitLayout } from '@components/app/split-layout/layout';
import { ContactEnrollments } from './components/contact-enrollments';
import { normalizeEmail } from './core/model';
import { useMarketingEnrollments } from './email-marketing';

export function MarketingContactCard(props: { email: string }) {
  const query = useMarketingEnrollments();
  const { openWithSplit } = useSplitLayout();
  return (
    <ContactEnrollments
      entries={
        query.isSuccess
          ? query.data.enrollments.filter(
              (entry) =>
                normalizeEmail(entry.contact.email) ===
                normalizeEmail(props.email)
            )
          : []
      }
      loading={query.isPending}
      error={
        query.error ? 'Could not load Email Marketing enrollments.' : undefined
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
