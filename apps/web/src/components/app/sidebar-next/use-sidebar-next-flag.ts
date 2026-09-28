import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableNewAppViews } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether `SidebarRail` renders in place of `AppSidebar`. Shares the
 * `enable-new-app-views` gate with the rebuilt app surfaces.
 */
export function useSidebarNextFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableNewAppViews);
  return () => flag().enabled;
}
