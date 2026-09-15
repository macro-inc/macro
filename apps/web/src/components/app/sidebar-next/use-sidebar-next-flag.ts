import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSidebarNext } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether `SidebarRail` renders in place of `AppSidebar`. Enabled by default
 * on this branch; VITE_ENABLE_SIDEBAR_NEXT=false restores the old sidebar.
 */
export function useSidebarNextFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableSidebarNext);
  return () => flag().enabled;
}
