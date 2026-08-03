import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CALENDAR_UI_FLAG,
  ENABLE_CALENDAR_UI_OVERRIDE,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

export function useCalendarUiFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(ENABLE_CALENDAR_UI_FLAG, {
    enabledOverride: ENABLE_CALENDAR_UI_OVERRIDE,
  });
  return () => flag().enabled;
}
