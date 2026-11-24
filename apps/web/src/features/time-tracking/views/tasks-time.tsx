import { ViewSidebar } from '@app/components/view-shell';
import { ListHeader } from '@app/components/view-shell/ListHeader';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import PlayIcon from '@icon/system/regular/play.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Popover } from '@kobalte/core/popover';
import { Button } from '@ui';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import type { TimeSummaryKey } from '../components/time-summary-types';
import { WeekGrid, type WeekGridRow } from '../components/week-grid';
import { WeekStepper } from '../components/week-stepper';
import { useTimeTracking } from '../context/time-tracking-context';
import { weekDays, weekRows } from '../core/week';
import { createWeekTime, type WeekTime } from '../primitives/create-week-time';
import { BreakdownSkeleton, SummaryFailed } from './shared/project-time-parts';
import type {
  PickedTask,
  TaskPicker,
  TasksTimeViewProps,
} from './shared/tasks-time-props';
import { createTimerActions } from './shared/timer-actions';
import { WeekCell } from './week-cell';

const NO_EXTRA_ROWS: readonly TimeSummaryKey[] = [];

function taskKey(task: PickedTask): TimeSummaryKey {
  return {
    by: 'TASK',
    userId: null,
    taskId: task.id,
    date: null,
    task: { __typename: 'GraphqlSoupDocument', id: task.id, name: task.name },
  };
}

/** A button that opens the host's task search beside it. */
function PickTaskButton(props: {
  pickTask: TaskPicker;
  onPick(task: PickedTask): void;
  children: JSX.Element;
  variant: 'ghost' | 'secondary';
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      gutter={4}
    >
      <Popover.Trigger as={Button} variant={props.variant} size="md">
        {props.children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="menu-surface z-modal w-80 outline-none">
          <Show when={open()}>
            {props.pickTask({
              onPick: (task) => {
                setOpen(false);
                props.onPick(task);
              },
              onClose: () => setOpen(false),
            })}
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function WeekHeader(props: {
  title: string;
  week: WeekTime;
  actions?: JSX.Element;
}): JSX.Element {
  return (
    <ListHeader
      title={<ViewSidebar.Title caret={false}>{props.title}</ViewSidebar.Title>}
    >
      <WeekStepper
        week={props.week.days()}
        current={props.week.offset() === 0}
        onPrevious={props.week.previousWeek}
        onNext={props.week.nextWeek}
        onThisWeek={props.week.thisWeek}
      />
      {props.actions}
    </ListHeader>
  );
}

function WeekBody(props: { week: WeekTime; children: JSX.Element }) {
  return (
    <div class="min-h-0 flex-1 overflow-auto px-4 pt-2 pb-8">
      <Switch>
        <Match when={props.week.failed()}>
          <SummaryFailed
            onRetry={() => fireAndForget(props.week.refetch(), 'time-tracking')}
          />
        </Match>
        <Match when={props.week.pending()}>
          <BreakdownSkeleton />
        </Match>
        <Match when={props.week.summary()}>{props.children}</Match>
      </Switch>
    </div>
  );
}

/**
 * My week: the viewer's tasks down, the week's days across. A cell takes a
 * length for that task and day; Add task puts a task on the sheet before
 * any time is logged on it.
 */
function MyWeekDesktop(props: TasksTimeViewProps): JSX.Element {
  const week = createWeekTime({
    scope: 'MINE',
    groupBy: 'TASK',
    thenBy: 'DAY',
    clock: props.clock,
  });
  usePending('time.week', week.pending);
  const timerActions = createTimerActions(useTimeTracking());
  const [added, setAdded] = createSignal<PickedTask[]>([]);
  const addRow = (task: PickedTask) =>
    setAdded((tasks) =>
      tasks.some((other) => other.id === task.id) ? tasks : [...tasks, task]
    );
  /** A row written in stays on the sheet, even once its time is deleted. */
  const written = (taskId: string) => {
    addRow({ id: taskId, name: nameOf(taskId) });
    fireAndForget(week.refetch(), 'time-tracking');
  };
  const rows = (): WeekGridRow[] =>
    weekRows(
      week.summary()?.groups ?? [],
      added().map(taskKey),
      (left, right) => left.taskId === right.taskId
    ).flatMap((row) =>
      row.key.taskId ? [{ id: row.key.taskId, byDay: row.byDay }] : []
    );
  const nameOf = (taskId: string) =>
    week.summary()?.groups.find((group) => group.key.taskId === taskId)?.key
      .task?.name ||
    added().find((task) => task.id === taskId)?.name ||
    t('timeTracking.untitledTask');
  return (
    <div class="flex size-full min-h-0 flex-col">
      <WeekHeader
        title={t('timeTracking.myWeek')}
        week={week}
        actions={
          <PickTaskButton
            variant="secondary"
            pickTask={props.pickTask}
            onPick={(task) => timerActions.start(task.id)}
          >
            <PlayIcon class="size-4" />
            {t('timeTracking.startTimer')}
          </PickTaskButton>
        }
      />
      <WeekBody week={week}>
        <Show when={rows().length === 0}>
          <p class="px-2 pb-2 text-sm text-ink-muted">
            {t('timeTracking.noTimeThisWeek')}
          </p>
        </Show>
        <WeekGrid
          label={t('timeTracking.myWeek')}
          rowHeader={t('timeTracking.byTask')}
          days={weekDays(week.days(), props.showWeekends())}
          today={props.clock.today()}
          rows={rows()}
          rowLabel={(taskId) => (
            <button
              type="button"
              class="block max-w-full truncate rounded-sm text-left not-touch:hover:underline"
              onClick={(event) => props.onOpenTask(taskId, { event })}
            >
              {nameOf(taskId)}
            </button>
          )}
          cell={(taskId, day, minutes) => (
            <WeekCell
              taskId={taskId}
              taskName={nameOf(taskId)}
              day={day}
              today={props.clock.today()}
              minutes={minutes()}
              person={props.person}
              editAccess={props.editAccess}
              onWritten={() => written(taskId)}
            />
          )}
          footer={
            <PickTaskButton
              variant="ghost"
              pickTask={props.pickTask}
              onPick={addRow}
            >
              <PlusIcon class="size-4" />
              {t('timeTracking.addTask')}
            </PickTaskButton>
          }
        />
      </WeekBody>
    </div>
  );
}

/** Team: the same week by person, every current member, read-only. */
function TeamWeekDesktop(props: TasksTimeViewProps): JSX.Element {
  const week = createWeekTime({
    scope: 'TEAM',
    groupBy: 'PERSON',
    thenBy: 'DAY',
    clock: props.clock,
  });
  usePending('time.team_week', week.pending);
  const rows = (): WeekGridRow[] =>
    weekRows(week.summary()?.groups ?? [], NO_EXTRA_ROWS, () => false).flatMap(
      (row) =>
        row.key.userId ? [{ id: row.key.userId, byDay: row.byDay }] : []
    );
  return (
    <div class="flex size-full min-h-0 flex-col">
      <WeekHeader title={t('timeTracking.team')} week={week} />
      <WeekBody week={week}>
        <WeekGrid
          label={t('timeTracking.team')}
          rowHeader={t('timeTracking.byPerson')}
          days={weekDays(week.days(), props.showWeekends())}
          today={props.clock.today()}
          rows={rows()}
          rowLabel={(userId) => props.person(userId)}
        />
      </WeekBody>
    </div>
  );
}

/** Time across projects in Tasks, on desktop: My week or Team. */
export function TasksTimeDesktop(props: TasksTimeViewProps): JSX.Element {
  return (
    <Switch>
      <Match when={props.view === 'week'}>
        <MyWeekDesktop {...props} />
      </Match>
      <Match when={props.view === 'team'}>
        <TeamWeekDesktop {...props} />
      </Match>
    </Switch>
  );
}
