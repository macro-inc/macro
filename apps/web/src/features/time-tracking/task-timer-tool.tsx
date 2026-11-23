import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/block-tool';
import { enableTimeTracking } from '@core/constant/featureFlags';
import PlayIcon from '@icon/system/fill/play-fill.svg';
import StopIcon from '@icon/system/fill/stop-fill.svg';
import { type Accessor, createMemo, type JSX, Show } from 'solid-js';
import { formatClock } from './core/timer-clock';
import { useTimeTrackingCapabilities } from './time-tracking-provider';
import { createTimerActions } from './views/shared/timer-actions';

/**
 * Start timer, or stop the task's running timer, as a row in a phone task's
 * title menu, behind `enable-time-tracking`. Shown to people who can edit.
 */
export function useTaskTimerTool(
  taskId: Accessor<string>,
  shown: Accessor<boolean>
): BlockTool {
  const flag = useFeatureFlag(enableTimeTracking);
  const live = createMemo(() => {
    if (flag().enabled !== true || !shown()) return undefined;
    const capabilities = useTimeTrackingCapabilities();
    return {
      timer: capabilities.runningTimer,
      actions: createTimerActions(capabilities),
    };
  });
  const timingThis = () => live()?.timer.timer()?.taskId === taskId();
  const Icon = (props: JSX.SvgSVGAttributes<SVGSVGElement>) => (
    <Show when={timingThis()} fallback={<PlayIcon {...props} />}>
      <StopIcon {...props} />
    </Show>
  );
  return {
    label: () =>
      timingThis()
        ? t('timeTracking.stopTimerCount', {
            count: formatClock(live()?.timer.seconds() ?? 0),
          })
        : t('timeTracking.startTimer'),
    icon: Icon,
    action: () => {
      const state = live();
      if (!state) return;
      if (timingThis()) state.actions.stop();
      else state.actions.start(taskId());
    },
    condition: () => live() !== undefined,
    get disabledReason() {
      return live()?.timer.offline()
        ? t('timeTracking.timerOffline')
        : undefined;
    },
  };
}
