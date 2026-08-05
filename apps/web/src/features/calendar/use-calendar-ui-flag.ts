import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CALENDAR_PROMPT_MOBILE_FLAG,
  ENABLE_CALENDAR_PROMPT_MOBILE_OVERRIDE,
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
 * Whether the "Enable calendar" prompt may surface on this device. Always true
 * on desktop; on a phone it defers to `enable-calendar-prompt-mobile`, which is
 * off until the mobile toast layout can present the prompt properly.
 */
export function useCalendarPromptAllowed(): Accessor<boolean> {
  const mobileFlag = useFeatureFlag(ENABLE_CALENDAR_PROMPT_MOBILE_FLAG, {
    enabledOverride: ENABLE_CALENDAR_PROMPT_MOBILE_OVERRIDE,
  });
  return () => !isMobile() || mobileFlag().enabled;
}
