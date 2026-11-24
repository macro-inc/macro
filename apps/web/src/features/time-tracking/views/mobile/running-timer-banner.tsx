import { t } from '@app/lib/i18n';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { isMobile } from '@core/mobile/isMobile';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import StopIcon from '@icon/system/fill/stop-fill.svg';
import { Button } from '@ui/components/Button';
import { type JSX, Show } from 'solid-js';
import { useTimeTracking } from '../../context/time-tracking-context';
import { formatClock } from '../../core/timer-clock';
import { createTimerActions } from '../shared/timer-actions';

/**
 * The running timer above the phone's dock, on every screen: its task opens
 * on a tap, and the square stops it and logs the time.
 */
export function RunningTimerBanner(props: {
  onOpenTask: (taskId: string) => void;
}): JSX.Element {
  const capabilities = useTimeTracking();
  const timer = capabilities.runningTimer;
  const actions = createTimerActions(capabilities);
  const visible = () =>
    isMobile() && Boolean(timer.timer()) && !virtualKeyboardVisible();
  const taskName = () =>
    timer.timer()?.task?.name?.trim() || t('timeTracking.untitledTask');

  return (
    <FloatRegion region="timer" active={visible}>
      <Show when={visible() && timer.timer()}>
        {(running) => (
          <div class="px-(--mobile-chrome-gutter) pointer-events-auto">
            <div class="island flex items-center gap-2 rounded-full p-1.5 pl-4">
              <span
                aria-hidden="true"
                class="size-2 shrink-0 rounded-full bg-failure"
              />
              <button
                type="button"
                class="min-w-0 flex-1 truncate py-2 text-left text-sm font-medium text-ink"
                onClick={() => props.onOpenTask(running().taskId)}
              >
                {taskName()}
              </button>
              <span class="shrink-0 text-sm tabular-nums text-ink">
                {formatClock(timer.seconds())}
              </span>
              <Button
                variant="secondary"
                size="icon-lg"
                class="rounded-full"
                disabled={timer.busy() || timer.offline()}
                aria-label={t('timeTracking.stopTimerCount', {
                  count: formatClock(timer.seconds()),
                })}
                onClick={actions.stop}
              >
                <StopIcon class="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Show>
    </FloatRegion>
  );
}
