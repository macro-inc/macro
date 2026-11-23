import { t } from '@app/lib/i18n';
import StopIcon from '@icon/system/fill/stop-fill.svg';
import { Popover } from '@kobalte/core/popover';
import { Button } from '@ui/components/Button';
import { createSignal, type JSX, Show } from 'solid-js';
import { TimerPanel } from '../components/timer-panel';
import { useTimeTracking } from '../context/time-tracking-context';
import { formatCompactClock } from '../core/timer-clock';
import { createTimerActions } from './shared/timer-actions';

/**
 * The running timer at the bottom of the desktop rail, on every screen. It
 * opens a card to stop and log it, open its task, or discard it.
 */
export function RunningTimerRail(props: {
  onOpenTask: (taskId: string, newSplit: boolean) => void;
}): JSX.Element {
  const capabilities = useTimeTracking();
  const timer = capabilities.runningTimer;
  const actions = createTimerActions(capabilities);
  const [open, setOpen] = createSignal(false);
  const taskName = () =>
    timer.timer()?.task?.name?.trim() || t('timeTracking.untitledTask');
  const close = (run: () => void) => () => {
    setOpen(false);
    run();
  };

  return (
    <Show when={timer.timer()}>
      {(running) => (
        <Popover
          open={open()}
          onOpenChange={setOpen}
          placement="right-end"
          gutter={8}
        >
          <Popover.Trigger
            as={Button}
            variant="danger"
            size="icon-md"
            class="size-10 cursor-default flex-col gap-0.5 rounded-xl"
            aria-label={t('timeTracking.timerOn', { task: taskName() })}
            tooltip={{
              content: t('timeTracking.timerOn', { task: taskName() }),
              placement: 'right',
            }}
            draggable={false}
            data-sidebar-next-item="running-timer"
          >
            <StopIcon class="size-2.5 shrink-0" />
            <span class="text-[10px] font-medium leading-none tabular-nums">
              {formatCompactClock(timer.seconds())}
            </span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="menu-surface z-modal w-72 p-3 outline-none">
              <TimerPanel
                taskName={taskName()}
                startedAt={running().startedAt}
                seconds={timer.seconds()}
                disabled={timer.busy() || timer.offline()}
                onStop={close(actions.stop)}
                onDiscard={close(actions.discard)}
                onOpenTask={(event) => {
                  setOpen(false);
                  props.onOpenTask(running().taskId, event.shiftKey);
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      )}
    </Show>
  );
}
