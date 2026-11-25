import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableEmailFocus, enableReminders } from '@core/constant/featureFlags';
import { match } from 'ts-pattern';
import {
  type EmailSearchScopeId,
  emailSearchScopeTab,
} from './search/email-search-scope';
import type { EmailTab } from './types';

/** Whether a flag-gated tab is on, still waiting for its flags, or off. */
export type EmailTabAvailability = 'on' | 'loading' | 'off';

type Flag = { enabled: boolean; loading: boolean };

function availability(flag: Flag): EmailTabAvailability {
  if (flag.loading) return 'loading';
  return flag.enabled ? 'on' : 'off';
}

/** The one rule for which Email tabs are flag-gated. Every other tab is on. */
export function useEmailTabAvailability(): (
  tab: EmailTab
) => EmailTabAvailability {
  const reminders = useFeatureFlag(enableReminders);
  const focus = useFeatureFlag(enableEmailFocus);
  return (tab) =>
    match(tab)
      .with('reminders', () => availability(reminders()))
      .with('focus', () => availability(focus()))
      .otherwise(() => 'on' as const);
}

/** Whether the person has the view an `in:` filter names. */
export function useEmailSearchScopeAvailability(): (
  scope: EmailSearchScopeId
) => boolean {
  const availability = useEmailTabAvailability();
  return (scope) => {
    const tab = emailSearchScopeTab(scope);
    return tab === undefined || availability(tab) === 'on';
  };
}
