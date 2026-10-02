import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableReminders } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { debouncedDependent } from '@core/util/debounce';
import { queryReadyGate } from '@queries/gate';
import { collectionReminderEntity } from '@queries/reminders/collection';
import { useEmailReminderSummaries } from '@queries/reminders/email-collection';
import { createMemo, createSignal, type ParentProps, Suspense } from 'solid-js';
import {
  type EmailRowReminder,
  EmailRowRemindersProvider,
} from './context/email-row-reminders';

/** Production composition owns one batch reader for the collection's mounted rows. */
export function EmailRowRemindersQueryProvider(props: ParentProps) {
  const userId = useUserId();
  const enabled = useFeatureFlag(enableReminders);
  const registrations = new Map<string, number>();
  const [ids, setIds] = createSignal<string[]>([]);
  const threadIds = debouncedDependent(ids, 30);
  const queries = useEmailReminderSummaries(() => ({
    userId: userId(),
    enabled: enabled().enabled,
    threadIds: threadIds(),
  }));
  const summaries = createMemo(() => {
    const result = new Map<string, EmailRowReminder>();
    if (!enabled().enabled) return result;
    for (const query of queries) {
      if (!queryReadyGate(query)) continue;
      for (const row of query.data)
        result.set(row.threadId, {
          nearest: collectionReminderEntity(row.nearest),
          count: row.count,
        });
    }
    return result;
  });
  const register = (id: string) => {
    registrations.set(id, (registrations.get(id) ?? 0) + 1);
    setIds([...registrations.keys()]);
    return () => {
      const remaining = (registrations.get(id) ?? 1) - 1;
      if (remaining) registrations.set(id, remaining);
      else registrations.delete(id);
      setIds([...registrations.keys()]);
    };
  };
  return (
    <Suspense>
      <EmailRowRemindersProvider
        value={{ register, get: (id) => summaries().get(id) }}
      >
        {props.children}
      </EmailRowRemindersProvider>
    </Suspense>
  );
}
