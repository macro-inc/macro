import { ReminderDetails } from '@app/features/reminders/ReminderEditorSplit';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useParams } from '@app/lib/split-router';
import { PreviewFrame } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableReminders } from '@core/constant/featureFlags';
import { createEffect, on, Show } from 'solid-js';
import { useHomeView } from '../home-view-context';
import { HomeReturnBreadcrumb } from './HomeReturnBreadcrumb';

/** Lightweight reminder details inside Home's current route-owned preview. */
export function HomeReminderDetailRouteView() {
  const params = useParams<{ reminderId?: string }>();
  const panel = useSplitPanelOrThrow();
  const reminders = useFeatureFlag(enableReminders);
  const { closePreview } = useHomeView();

  createEffect(
    on(
      () => (reminders().loading ? undefined : reminders().enabled),
      (enabled) => {
        if (enabled === false) closePreview();
      }
    )
  );

  return (
    <Show when={!reminders().loading} fallback={<LoadingBlock />}>
      <Show when={reminders().enabled}>
        <div class="flex size-full min-h-0">
          <PreviewFrame
            splitPanelContext={panel}
            headerLeading={<HomeReturnBreadcrumb onReturn={closePreview} />}
            locationKey={() => params.reminderId}
          >
            <ReminderDetails
              reminderId={params.reminderId}
              onClose={closePreview}
            />
          </PreviewFrame>
        </div>
      </Show>
    </Show>
  );
}
