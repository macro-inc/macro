import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { ContactEnrollments } from './components/contact-enrollments';
import { isUnsubscribed, normalizeEmail } from './core/model';
import {
  useContactAttention,
  useMarketingEnrollments,
} from './queries/enrollments-query';

export function MarketingContactCard(props: { email: string }) {
  const query = useMarketingEnrollments();
  const { openWithSplit } = useSplitLayout();
  // Gate on pending only, so cached rows stay through a failed refetch (FE-48).
  const snapshot = () => (query.isPending ? undefined : query.data);
  const entries = () =>
    snapshot()?.enrollments.filter(
      (entry) =>
        normalizeEmail(entry.contact.email) === normalizeEmail(props.email)
    ) ?? [];
  const attention = useContactAttention(entries);
  const delivery = () => (attention.isPending ? undefined : attention.data);
  return (
    <ContactEnrollments
      entries={entries()}
      loading={query.isPending}
      unsubscribed={!!snapshot() && isUnsubscribed(snapshot()!, props.email)}
      attention={(entry) => delivery()?.reasons[entry.id]}
      sentSteps={(entry) => delivery()?.sent[entry.id]}
      isFinished={(entry) => !!delivery()?.finished.includes(entry.id)}
      error={
        query.isError && !snapshot()
          ? t('emailMarketing.enrollmentsLoadFailed')
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
