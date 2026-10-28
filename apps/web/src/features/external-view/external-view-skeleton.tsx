import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

/** External while its code or the rollout flag loads. */
export function ExternalViewSkeleton() {
  return (
    <ViewSkeleton.Root
      asidePreferenceKey="external"
      aside={isTouchDevice() ? false : undefined}
    >
      <ViewSkeleton.Sidebar title="External" />
      <ViewSkeleton.Main title="WhatsApp" />
    </ViewSkeleton.Root>
  );
}
