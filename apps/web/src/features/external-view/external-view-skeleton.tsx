import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

/** External while its code or the rollout flag loads. */
export function ExternalViewSkeleton() {
  return (
    <ViewSkeleton.Root
      asidePreferenceKey="external"
      // The loaded view keeps the shell's default sizing; match it so a saved
      // sidebar width does not shift when the view replaces the skeleton.
      aside={isTouchDevice() ? false : {}}
      main={{}}
    >
      <ViewSkeleton.Sidebar title="External" />
      <ViewSkeleton.Main title="WhatsApp">
        <div class="touch:pt-(--mobile-content-inset-top)">
          <ViewSkeleton.Rows label="Loading WhatsApp" class="px-2" />
        </div>
      </ViewSkeleton.Main>
    </ViewSkeleton.Root>
  );
}
