import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_SIDEBAR_NEXT_FLAG,
  ENABLE_SIDEBAR_NEXT_OVERRIDE,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether `SidebarNext` renders in place of `AppSidebar`. On in dev by default;
 * elsewhere it needs the `enable-sidebar-next` PostHog flag. Set
 * VITE_ENABLE_SIDEBAR_NEXT=false to fall back to `AppSidebar` locally.
 */
export function useSidebarNextFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(ENABLE_SIDEBAR_NEXT_FLAG, {
    enabledOverride: ENABLE_SIDEBAR_NEXT_OVERRIDE,
  });
  return () => flag().enabled;
}
