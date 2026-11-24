import { formatLocale, t } from '@app/lib/i18n';
import { activeElement } from '@app/signal/focus';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { fireAndForget } from '@core/util/fireAndForget';
import { isEditableInput } from '@core/util/isEditableInput';
import ClockIcon from '@icon/system/regular/clock.svg';
import { PillButton } from '@ui';
import { parseISO } from 'date-fns';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { BreakdownList } from '../../components/time-breakdown';
import { TimeKeyLabel } from '../../components/time-key-label';
import { WeekStepper } from '../../components/week-stepper';
import { formatLength } from '../../core/format-length';
import {
  createWeekTime,
  type WeekTime,
} from '../../primitives/create-week-time';
import {
  BreakdownSkeleton,
  NoTimeLogged,
  SummaryFailed,
} from '../shared/project-time-parts';
import type {
  PickedTask,
  TasksTimeViewProps,
} from '../shared/tasks-time-props';
import { TaskTimeSheet } from './task-time-sheet';

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseISO(day));
}

function WeekTop(props: {
  title: string;
  week: WeekTime;
  navigation?: JSX.Element;
}): JSX.Element {
  const total = () => props.week.summary()?.totalMinutes;
  return (
    <div class="flex flex-col gap-3 px-4 pt-[calc(var(--mobile-content-inset-top,0px)+0.75rem)] pb-2">
      <div class="flex items-center gap-2">
        {props.navigation}
        <WeekStepper
          week={props.week.days()}
          today={props.week.today()}
          current={props.week.offset() === 0}
          onPrevious={props.week.previousWeek}
          onNext={props.week.nextWeek}
          onThisWeek={props.week.thisWeek}
        />
      </div>
      <div class="flex items-baseline justify-between px-1">
        <h1 class="text-lg font-semibold">{props.title}</h1>
        <Show when={total() !== undefined}>
          <span class="text-lg font-semibold tabular-nums">
            {formatLength(total() ?? 0)}
          </span>
        </Show>
      </div>
    </div>
  );
}

function WeekState(props: { week: WeekTime; children: JSX.Element }) {
  return (
    <Switch>
      <Match when={props.week.failed()}>
        <SummaryFailed
          onRetry={() => fireAndForget(props.week.refetch(), 'time-tracking')}
        />
      </Match>
      <Match when={props.week.pending()}>
        <BreakdownSkeleton />
      </Match>
      <Match when={props.week.summary()?.groups.length === 0}>
        <NoTimeLogged />
      </Match>
      <Match when={props.week.summary()}>{props.children}</Match>
    </Switch>
  );
}

/**
 * My week on a phone: the week's days with their tasks and totals. Log time
 * asks for a task, then opens that task's Time sheet.
 */
function MyWeekMobile(props: TasksTimeViewProps): JSX.Element {
  const week = createWeekTime({
    scope: 'MINE',
    groupBy: 'DAY',
    thenBy: 'TASK',
    clock: props.clock,
    showWeekends: props.showWeekends,
  });
  const [picking, setPicking] = createSignal(false);
  const [logging, setLogging] = createSignal<PickedTask>();
  return (
    <div class="flex size-full min-h-0 flex-col overflow-y-auto pb-[calc(max(var(--safe-bottom,0px),var(--mobile-content-inset-bottom,0px))+5rem)]">
      <WeekTop
        title={t('timeTracking.myWeek')}
        week={week}
        navigation={props.navigation}
      />
      <WeekState week={week}>
        <div class="flex flex-col gap-4 px-2">
          <For each={week.summary()?.groups}>
            {(day) => (
              <section aria-label={dayLabel(day.key.date ?? '')}>
                <div class="flex items-baseline justify-between px-2 py-1 text-sm font-medium">
                  <span>{dayLabel(day.key.date ?? '')}</span>
                  <span class="tabular-nums">{formatLength(day.minutes)}</span>
                </div>
                <ul>
                  <For each={day.rows}>
                    {(row) => (
                      <li>
                        <button
                          type="button"
                          data-press-surface
                          disabled={!row.key.taskId}
                          class="flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-left text-sm"
                          onClick={(event) => {
                            if (row.key.taskId)
                              props.onOpenTask(row.key.taskId, { event });
                          }}
                        >
                          <span class="flex min-w-0 flex-1 items-center">
                            <TimeKeyLabel
                              timeKey={row.key}
                              person={props.person}
                            />
                          </span>
                          <span class="shrink-0 text-ink-muted tabular-nums">
                            {formatLength(row.minutes)}
                          </span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </div>
      </WeekState>
      <FloatRegion
        region="accessory"
        active={() =>
          !virtualKeyboardVisible() && !isEditableInput(activeElement())
        }
      >
        <div class="flex h-(--mobile-chrome-button-size) justify-end px-(--mobile-chrome-gutter) pointer-events-auto">
          <PillButton
            tone="cta"
            icon={ClockIcon}
            onClick={() => setPicking(true)}
          >
            {t('timeTracking.logTime')}
          </PillButton>
        </div>
      </FloatRegion>
      <PickerSheet.Root open={picking()} onCancel={() => setPicking(false)}>
        <MobileDrawer.Title class="px-6 pt-4 pb-3 text-lg font-semibold">
          {t('timeTracking.logTime')}
        </MobileDrawer.Title>
        <PickerSheet.Body>
          <Show when={picking()}>
            {props.pickTask({
              onPick: (task) => {
                setPicking(false);
                setLogging(task);
              },
              onClose: () => setPicking(false),
            })}
          </Show>
        </PickerSheet.Body>
      </PickerSheet.Root>
      <Show when={logging()} keyed>
        {(task) =>
          props.editAccess(task.id, (canEdit) => (
            <TaskTimeSheet
              taskId={task.id}
              minutes={0}
              canEdit={canEdit() === true}
              person={props.person}
              open
              onOpenChange={(open) => {
                if (!open) setLogging(undefined);
              }}
            />
          ))
        }
      </Show>
    </div>
  );
}

/** Team on a phone: each current member's week, opening to their days. */
function TeamWeekMobile(props: TasksTimeViewProps): JSX.Element {
  const week = createWeekTime({
    scope: 'TEAM',
    groupBy: 'PERSON',
    thenBy: 'DAY',
    clock: props.clock,
    showWeekends: props.showWeekends,
  });
  return (
    <div class="flex size-full min-h-0 flex-col overflow-y-auto pb-[calc(max(var(--safe-bottom,0px),var(--mobile-content-inset-bottom,0px))+1rem)]">
      <WeekTop
        title={t('timeTracking.team')}
        week={week}
        navigation={props.navigation}
      />
      <WeekState week={week}>
        <div class="px-2">
          <BreakdownList
            groups={week.summary()?.groups ?? []}
            person={props.person}
            onOpenTask={props.onOpenTask}
          />
        </div>
      </WeekState>
    </div>
  );
}

/** Time across projects in Tasks, on touch: My week or Team. */
export function TasksTimeMobile(props: TasksTimeViewProps): JSX.Element {
  return (
    <Switch>
      <Match when={props.view === 'week'}>
        <MyWeekMobile {...props} />
      </Match>
      <Match when={props.view === 'team'}>
        <TeamWeekMobile {...props} />
      </Match>
    </Switch>
  );
}
