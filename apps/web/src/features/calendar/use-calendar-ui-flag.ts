import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CALENDAR_PROMPT_MOBILE_FLAG,
  ENABLE_CALENDAR_PROMPT_MOBILE_OVERRIDE,
  ENABLE_CALENDAR_PROMPT_WEB_FLAG,
  ENABLE_CALENDAR_PROMPT_WEB_OVERRIDE,
  ENABLE_CALENDAR_UI_FLAG,
  ENABLE_CALENDAR_UI_OVERRIDE,
} from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import type { Accessor } from 'solid-js';

export function useCalendarUiFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(ENABLE_CALENDAR_UI_FLAG, {
    enabledOverride: ENABLE_CALENDAR_UI_OVERRIDE,
  });
  return () => flag().enabled;
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
  const mobileFlag = useFeatureFlag(ENABLE_CALENDAR_PROMPT_MOBILE_FLAG, {
    enabledOverride: ENABLE_CALENDAR_PROMPT_MOBILE_OVERRIDE,
  });
  const webFlag = useFeatureFlag(ENABLE_CALENDAR_PROMPT_WEB_FLAG, {
    enabledOverride: ENABLE_CALENDAR_PROMPT_WEB_OVERRIDE,
  });
  return () => (isMobile() ? mobileFlag() : webFlag()).enabled;
}
