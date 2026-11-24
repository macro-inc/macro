import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { openDialog } from '@ui/components/ImperativeDialog';
import { err } from 'neverthrow';
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

/** What to say about a refused timer change; nothing for a press while another runs. */
function failureMessage(error: TimeWriteError): string | undefined {
  if (error.kind === 'refused' && error.code === 'BUSY') return undefined;
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
  const fail = (error: TimeWriteError) => {
    const message = failureMessage(error);
    if (message) toast.failure(message);
  };
  /** The running timer's task name, when it is the timer the server named. */
  const nameOf = (timerId: string, local: RunningTimer | undefined) =>
    local?.id === timerId
      ? runningTaskName(local)
      : t('timeTracking.yourRunningTimer');

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
      if (discarded.isErr()) fail(discarded.error);
      return discarded.isOk();
    }
    const stopped = await runningTimer.stop(
      choice.kind === 'log-all'
        ? { timerId: timer.id, logAll: true }
        : { timerId: timer.id, endedAt: choice.endedAt }
    );
    if (stopped.isErr()) {
      fail(stopped.error);
      return false;
    }
    const entry =
      stopped.value.kind === 'committed' ? stopped.value.data?.entry : null;
    if (entry) showLogged(entry, name);
    return true;
  }

  /**
   * Undo a switch from what the server says it stopped: discard the new
   * timer, start the stopped one again at its own start, and only then delete
   * the entry it saved, so a failed step never loses the time. If that delete
   * fails, the restarted timer is discarded again, so the entry stays the one
   * record of the interval. No other timer change runs in between.
   */
  async function undoSwitch(
    stopped: TimeEntryFieldsFragment,
    newTimerId: string
  ) {
    const startedAt = stopped.startedAt;
    if (!startedAt) return toast.failure(t('timeTracking.undoFailed'));
    let began = false;
    const undone = await runningTimer.exclusive(async (timerOps) => {
      began = true;
      const discarded = await timerOps.discard(newTimerId);
      if (discarded.isErr()) return err(discarded.error);
      const restarted = await timerOps.start({
        taskId: stopped.taskId,
        startedAt,
      });
      if (restarted.isErr()) return err(restarted.error);
      const removed = await writes.remove(stopped);
      if (removed.isOk()) return removed;
      const restartedId =
        restarted.value.kind === 'committed'
          ? restarted.value.data?.timeTracking.runningTimer?.id
          : undefined;
      if (restartedId) await timerOps.discard(restartedId);
      return removed;
    });
    if (undone.isErr() && !began) return fail(undone.error);
    if (undone.isErr()) toast.failure(t('timeTracking.undoFailed'));
  }

  async function start(taskId: string): Promise<void> {
    const interaction = beginInteraction('time.timer.start', {
      attributes: { 'task.id': taskId },
    });
    try {
      const previous = runningTimer.timer();
      const started = await runningTimer.start({ taskId });
      if (started.isErr()) {
        if (started.error.kind === 'over-limit') {
          const resolved = await resolveOverLimit(
            started.error.timer,
            nameOf(started.error.timer.id, previous)
          );
          if (resolved) await start(taskId);
          return;
        }
        fail(started.error);
        return;
      }
      const data =
        started.value.kind === 'committed' ? started.value.data : undefined;
      const stoppedEntry = data?.stoppedEntry;
      const newTimer = data?.timeTracking.runningTimer;
      if (!stoppedEntry || !newTimer) return;
      // A saved timer entry keeps its timer's id: name the task only when it
      // is the timer this device saw running.
      toast.success(
        t('timeTracking.switched', {
          previous: nameOf(stoppedEntry.id, previous),
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
                  undoSwitch(stoppedEntry, newTimer.id),
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
          await resolveOverLimit(
            stopped.error.timer,
            nameOf(stopped.error.timer.id, timer)
          );
          return;
        }
        fail(stopped.error);
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
    if (discarded.isErr()) fail(discarded.error);
  }

  return {
    start: (taskId: string) => fireAndForget(start(taskId), 'time-tracking'),
    stop: () => fireAndForget(stop(), 'time-tracking'),
    discard: () => fireAndForget(discard(), 'time-tracking'),
  };
}

export type TimerActions = ReturnType<typeof createTimerActions>;
