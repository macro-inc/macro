import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableEmailFocus,
  enableGraphqlSoup,
  enableReminders,
} from '@core/constant/featureFlags';
import { match } from 'ts-pattern';
import type { EmailTab } from './types';

/** Whether a flag-gated tab is on, still waiting for its flags, or off. */
export type EmailTabAvailability = 'on' | 'loading' | 'off';

type Flag = { enabled: boolean; loading: boolean };

function availability(...flags: Flag[]): EmailTabAvailability {
  if (flags.some((flag) => !flag.enabled && !flag.loading)) return 'off';
  return flags.some((flag) => flag.loading) ? 'loading' : 'on';
}

/** The one rule for which Email tabs are flag-gated. Every other tab is on. */
export function useEmailTabAvailability(): (
  tab: EmailTab
) => EmailTabAvailability {
  const reminders = useFeatureFlag(enableReminders);
  const focus = useFeatureFlag(enableEmailFocus);
  // Focus is read through GraphQL Soup, and its Done/Undo use Soup's done
  // intents, which only the GraphQL mark-done path publishes.
  const graphqlSoup = useFeatureFlag(enableGraphqlSoup);
  return (tab) =>
    match(tab)
      .with('reminders', () => availability(reminders()))
      .with('focus', () => availability(focus(), graphqlSoup()))
      .otherwise(() => 'on' as const);
}
