import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { openDialog } from '@ui/components/ImperativeDialog';
import { EditEntryDialog } from '../../components/edit-entry-dialog';
import {
  type OverLimitChoice,
  OverLimitDialog,
} from '../../components/over-limit-dialog';
import type { TimeTrackingCapabilities } from '../../context/time-tracking-context';
import { formatLength } from '../../core/format-length';
import { createTimeEntryWrites } from '../../primitives/create-task-time';
import type { RunningTimer } from '../../queries/timer';
import type {
  OverLimitTimer,
  TimeWriteError,
} from '../../queries/write-result';
import { reportWrite } from './report-write';

function taskName(name: string | null | undefined): string {
  return name?.trim() || t('timeTracking.untitledTask');
}

function runningTaskName(timer: RunningTimer): string {
  return taskName(timer.task?.name);
}

function failureMessage(error: TimeWriteError): string {
  if (error.kind === 'refused' && error.code === 'OFFLINE') {
    return t('timeTracking.timerOffline');
  }
  if (error.kind === 'refused' && error.code === 'FORBIDDEN') {
    return t('timeTracking.notAllowed');
  }
  return t('timeTracking.timerFailed');
}

function chooseOverLimit(
  timer: OverLimitTimer,
  name: string,
  nowMs: number
): Promise<OverLimitChoice | undefined> {
  let chosen: OverLimitChoice | undefined;
  const handle = openDialog(OverLimitDialog, {
    taskName: name,
    startedAt: timer.startedAt,
    nowMs,
    onChoose: (choice) => {
      chosen = choice;
      handle.close();
    },
  });
  return handle.closed.then(() => chosen);
}

/**
 * Start, stop and discard the person's timer with the design's confirmations:
 * a toast with Edit after a stop, a toast with Undo after a start that
 * stopped another timer, and the over-limit choice when the server refuses
 * to stop a timer that ran too long.
 */
export function createTimerActions(capabilities: TimeTrackingCapabilities) {
  const { runningTimer } = capabilities;
  const writes = createTimeEntryWrites(capabilities);

  const showLogged = (entry: TimeEntryFieldsFragment, name: string) => {
    toast.success(
      t('timeTracking.logged', {
        length: formatLength(entry.minutes),
        task: name,
      }),
      {
        actionLayout: 'inline',
        actions: [
          {
            label: t('timeTracking.edit'),
            onClick: () =>
              openDialog(EditEntryDialog, {
                entry,
                onSave: (values) =>
                  reportWrite(
                    writes.update(entry, values),
                    t('timeTracking.saveFailed')
                  ),
              }),
          },
        ],
      }
    );
  };

  /** Settle a timer the server refused to stop; true once it is gone. */
  async function resolveOverLimit(
    timer: OverLimitTimer,
    name: string
  ): Promise<boolean> {
    const choice = await chooseOverLimit(timer, name, runningTimer.now());
    if (!choice) return false;
    if (choice.kind === 'discard') {
      const discarded = await runningTimer.discard(timer.id);
      if (discarded.isErr()) toast.failure(failureMessage(discarded.error));
      return discarded.isOk();
    }
    const stopped = await runningTimer.stop(
      choice.kind === 'log-all'
        ? { timerId: timer.id, logAll: true }
        : { timerId: timer.id, endedAt: choice.endedAt }
    );
    if (stopped.isErr()) {
      toast.failure(failureMessage(stopped.error));
      return false;
    }
    const entry =
      stopped.value.kind === 'committed' ? stopped.value.data?.entry : null;
    if (entry) showLogged(entry, name);
    return true;
  }

  async function undoSwitch(
    previous: RunningTimer,
    entry: TimeEntryFieldsFragment,
    newTimerId: string
  ) {
    const discarded = await runningTimer.discard(newTimerId);
    if (discarded.isErr()) return toast.failure(t('timeTracking.undoFailed'));
    const removed = await writes.remove(entry);
    if (removed.isErr()) return toast.failure(t('timeTracking.undoFailed'));
    const restarted = await runningTimer.start({
      taskId: previous.taskId,
      startedAt: previous.startedAt,
    });
    if (restarted.isErr()) toast.failure(t('timeTracking.undoFailed'));
  }

  async function start(taskId: string): Promise<void> {
    const interaction = beginInteraction('time.timer.start', {
      attributes: { 'task.id': taskId },
    });
    try {
      const previous = runningTimer.timer();
      const started = await runningTimer.start({ taskId });
      if (started.isErr()) {
        if (started.error.kind === 'over-limit' && previous) {
          const resolved = await resolveOverLimit(
            started.error.timer,
            runningTaskName(previous)
          );
          if (resolved) await start(taskId);
          return;
        }
        toast.failure(failureMessage(started.error));
        return;
      }
      const data =
        started.value.kind === 'committed' ? started.value.data : undefined;
      const stoppedEntry = data?.stoppedEntry;
      const newTimer = data?.timeTracking.runningTimer;
      if (!stoppedEntry || !previous || !newTimer) return;
      toast.success(
        t('timeTracking.switched', {
          previous: runningTaskName(previous),
          length: formatLength(stoppedEntry.minutes),
          task: runningTaskName(newTimer),
        }),
        {
          actionLayout: 'inline',
          actions: [
            {
              label: t('timeTracking.undo'),
              onClick: () =>
                fireAndForget(
                  undoSwitch(previous, stoppedEntry, newTimer.id),
                  'time-tracking-undo'
                ),
            },
          ],
        }
      );
    } finally {
      interaction.end();
    }
  }

  async function stop(): Promise<void> {
    const timer = runningTimer.timer();
    if (!timer) return;
    const interaction = beginInteraction('time.timer.stop', {
      attributes: { 'task.id': timer.taskId },
    });
    try {
      const name = runningTaskName(timer);
      const stopped = await runningTimer.stop({ timerId: timer.id });
      if (stopped.isErr()) {
        if (stopped.error.kind === 'over-limit') {
          await resolveOverLimit(stopped.error.timer, name);
          return;
        }
        toast.failure(failureMessage(stopped.error));
        return;
      }
      const entry =
        stopped.value.kind === 'committed' ? stopped.value.data?.entry : null;
      if (entry) showLogged(entry, name);
      else toast.alert(t('timeTracking.timerDiscarded'));
    } finally {
      interaction.end();
    }
  }

  async function discard(): Promise<void> {
    const timer = runningTimer.timer();
    if (!timer) return;
    const discarded = await runningTimer.discard(timer.id);
    if (discarded.isErr()) toast.failure(failureMessage(discarded.error));
  }

  return {
    start: (taskId: string) => fireAndForget(start(taskId), 'time-tracking'),
    stop: () => fireAndForget(stop(), 'time-tracking'),
    discard: () => fireAndForget(discard(), 'time-tracking'),
  };
}

export type TimerActions = ReturnType<typeof createTimerActions>;
