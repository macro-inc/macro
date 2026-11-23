import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { toast } from '@core/component/Toast/Toast';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { type JSX, Show } from 'solid-js';
import { TimeTrackingProvider } from './time-tracking-provider';
import { RunningTimerBanner as RunningTimerBannerView } from './views/mobile/running-timer-banner';
import { RunningTimerRail as RunningTimerRailView } from './views/running-timer-rail';

/** Open the timed task, reusing a split that already shows it. */
function openTask(taskId: string, newSplit: boolean) {
  const result = openDocument('task', taskId, undefined, newSplit);
  if (result?.status === 'reused' && result.owner !== result.sourceOwner) {
    toast.alert('Content already open');
  }
}

/** The running timer in the desktop rail, behind `enable-time-tracking`. */
export function RunningTimerRail(): JSX.Element {
  const flag = useFeatureFlag(enableTimeTracking);
  return (
    <Show when={flag().enabled}>
      <TimeTrackingProvider>
        <RunningTimerRailView onOpenTask={openTask} />
      </TimeTrackingProvider>
    </Show>
  );
}

/** The running timer above the phone's dock, behind `enable-time-tracking`. */
export function RunningTimerBanner(): JSX.Element {
  const flag = useFeatureFlag(enableTimeTracking);
  return (
    <Show when={flag().enabled}>
      <TimeTrackingProvider>
        <RunningTimerBannerView
          onOpenTask={(taskId) => openTask(taskId, false)}
        />
      </TimeTrackingProvider>
    </Show>
  );
}
