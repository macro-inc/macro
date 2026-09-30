import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableReminders } from '@core/constant/featureFlags';
import { type Accessor, createMemo } from 'solid-js';
import { EMAIL_TABS, type EmailTabItem } from './constants';
import type { EmailTab } from './types';

/**
 * The tabs on offer right now. `EMAIL_TABS` is the full superset; the
 * flag-gated Reminders entry is dropped here so every tab surface — sidebar
 * rows, mobile pills, the number/cycle hotkeys — agrees on which tabs exist.
 * Subscribed through `useFeatureFlag`, so a flag that resolves after mount
 * still reaches the rendered list.
 */
export function useVisibleEmailTabs(): Accessor<EmailTabItem[]> {
  const reminders = useFeatureFlag(enableReminders);
  return createMemo(() =>
    reminders().enabled
      ? EMAIL_TABS
      : EMAIL_TABS.filter((tab) => tab.id !== 'reminders')
  );
}

export function useVisibleEmailTabIds(): Accessor<EmailTab[]> {
  const tabs = useVisibleEmailTabs();
  return () => tabs().map((tab) => tab.id);
}
