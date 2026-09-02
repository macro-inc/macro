import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_SIDEBAR_NEXT_FLAG,
  ENABLE_SIDEBAR_NEXT_OVERRIDE,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether `SidebarRail` renders in place of `AppSidebar`. Needs the
 * `enable-new-app-views` PostHog flag, in dev as much as anywhere else. Set
 * VITE_ENABLE_SIDEBAR_NEXT=true to force it on locally without PostHog.
 */
export function useSidebarNextFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(ENABLE_SIDEBAR_NEXT_FLAG, {
    enabledOverride: ENABLE_SIDEBAR_NEXT_OVERRIDE,
  });
  return () => flag().enabled;
}
