import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { queryReadyGate } from '@queries/gate';
import { useQuery } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { ContactEnrollments } from './components/contact-enrollments';
import { isUnsubscribed, normalizeEmail } from './core/model';
import {
  contactAttentionQueryOptions,
  marketingEnrollmentsQueryOptions,
} from './queries/enrollments-query';

export function MarketingContactCard(props: { email: string }) {
  const userId = useUserId();
  const query = useQuery(() => marketingEnrollmentsQueryOptions(userId()));
  const { openWithSplit } = useSplitLayout();
  // Gate on pending only, so cached rows stay through a failed refetch (FE-48).
  const snapshot = () => (queryReadyGate(query) ? query.data : undefined);
  const entries = createMemo(
    () =>
      snapshot()?.enrollments.filter(
        (entry) =>
          normalizeEmail(entry.contact.email) === normalizeEmail(props.email)
      ) ?? []
  );
  // Plain copies: the cached queryFn must not hold the snapshot query's store.
  const attention = useQuery(() =>
    contactAttentionQueryOptions(
      userId(),
      entries().map((entry) => structuredClone(unwrap(entry)))
    )
  );
  const delivery = () =>
    queryReadyGate(attention) ? attention.data : undefined;
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
