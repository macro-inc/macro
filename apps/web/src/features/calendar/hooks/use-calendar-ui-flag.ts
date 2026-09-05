import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableCalendarPromptMobile,
  enableCalendarPromptWeb,
  enableCalendarSearchUi,
  enableCalendarUi,
} from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import type { Accessor } from 'solid-js';

export function useCalendarUiFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCalendarUi);
  return () => flag().enabled;
}

/**
 * Whether the calendar search UI (Search-view calendar type/rows and the
 * in-calendar keyword search) is enabled. A sub-feature of the calendar UI, so
 * it requires `enable-calendar-ui` on top of its own flag.
 */
export function useCalendarSearchUiFlag(): Accessor<boolean> {
  const calendarUi = useCalendarUiFlag();
  const searchFlag = useFeatureFlag(enableCalendarSearchUi);
  return () => calendarUi() && searchFlag().enabled;
}

/**
 * Whether the "Enable calendar" prompt may surface on this device. Each form
 * factor has its own kill switch: a phone defers to
 * `enable-calendar-prompt-mobile`, which is off until the mobile toast layout
 * can present the prompt properly, and everything else defers to
 * `enable-calendar-prompt-web`. Both are gated by `enable-calendar-ui` at the
 * call site.
 */
export function useCalendarPromptAllowed(): Accessor<boolean> {
  const mobileFlag = useFeatureFlag(enableCalendarPromptMobile);
  const webFlag = useFeatureFlag(enableCalendarPromptWeb);
  return () => (isMobile() ? mobileFlag() : webFlag()).enabled;
}
