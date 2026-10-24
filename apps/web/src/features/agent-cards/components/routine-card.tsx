import { isClaimActive } from '@app/features/routines/core/claim';
import { getErrorMessage } from '@app/features/routines/core/routine-draft';
import { describeTriggers } from '@app/features/routines/core/routine-triggers';
import { draftFromSchedule } from '@app/features/routines/queries/routine-draft';
import { useRoutineQuery } from '@app/features/routines/queries/routines';
import {
  useRunScheduleNowMutation,
  useSetScheduleEnabledMutation,
} from '@app/features/routines/queries/schedules';
import { getCronTrigger } from '@app/features/routines/queries/triggers';
import { EntityIcon } from '@core/component/EntityIcon';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { toast } from '@core/component/Toast/Toast';
import { describeCron, isCronRepresentable, parseCron } from '@core/util/cron';
import { routineStatus } from '@entity/types/entity';
import Play from '@phosphor/play.svg';
import { queryReadyGate } from '@queries/gate';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { Button, cn } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { dayAndTime } from '../core/event-time';
import { actionLabel, actionTone } from '../core/labels';
import type { CardAction } from '../core/types';
import { Card, CardBody, CardFooter, CardHeader } from './kit/card';
import {
  CardBadge,
  CardPill,
  type CardTone,
  SkeletonSingle,
  Tile,
} from './kit/parts';
import { ReferenceCard } from './reference-card';

/** Where a routine stands: waiting for its next run, paused, or running. */
export type RoutineState = 'active' | 'paused' | 'running' | 'idle';

const STATES: Record<RoutineState, { label: string; tone: CardTone }> = {
  active: { label: 'Active', tone: 'ok' },
  paused: { label: 'Paused', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  idle: { label: 'No upcoming runs', tone: 'neutral' },
};

/**
 * A routine as a card, from values already worked out: what it is called,
 * whether it is running, when it runs and runs next, and the controls to
 * pause it, run it now or open it.
 */
export function RoutineCardView(props: {
  name: string;
  badge?: { label: string; tone: CardTone };
  /** What the step did, in a few words: `Paused`. */
  summary?: string | null;
  state: RoutineState;
  /** `Mondays at 8:00 AM`, `When an email arrives`. */
  schedule?: string;
  /** `Tomorrow at 8 AM`. */
  nextRun?: string;
  onOpen?: (event: MouseEvent) => void;
  /** Pause a routine that runs, or resume a paused one. */
  onToggle?: () => void;
  onRunNow?: () => void;
  /** A change the card asked for is on its way. */
  busy?: boolean;
}) {
  const state = () => STATES[props.state];
  return (
    <Card width="compact" data-agent-card="routine">
      <CardHeader
        center
        padded
        tile={
          <Tile>
            <EntityIcon targetType="routine" size="sm" />
          </Tile>
        }
        title={props.name}
        badge={
          <Show when={props.badge}>
            {(badge) => (
              <CardBadge tone={badge().tone}>{badge().label}</CardBadge>
            )}
          </Show>
        }
        subtitle={['Routine', props.summary].filter(Boolean).join(' · ')}
        trailing={
          <CardPill tone={state().tone}>
            <span
              class={cn(
                'size-1.5 rounded-full bg-current',
                props.state === 'running' && 'animate-pulse'
              )}
              aria-hidden="true"
            />
            {state().label}
          </CardPill>
        }
      />
      <CardBody class="pt-0">
        <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 text-xs leading-5">
          <dt class="text-ink-subtle">Schedule</dt>
          <dd class="truncate text-ink">{props.schedule ?? 'Custom'}</dd>
          <dt class="text-ink-subtle">Next run</dt>
          <dd class="truncate text-ink">
            <Switch fallback={props.nextRun ?? 'None scheduled'}>
              <Match when={props.state === 'paused'}>
                <span class="text-ink-muted">None while paused</span>
              </Match>
              <Match when={props.state === 'running'}>
                <span class="text-ink-muted">Running now</span>
              </Match>
            </Switch>
          </dd>
        </dl>
      </CardBody>
      <CardFooter small line>
        <Show when={props.onToggle}>
          {(toggle) => (
            <Button
              size="sm"
              variant="ghost"
              class="mr-auto"
              disabled={props.busy}
              onClick={() => toggle()()}
            >
              {props.state === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          )}
        </Show>
        <Show when={props.onOpen}>
          {(open) => (
            <Button
              size="sm"
              variant="outline"
              class={props.onToggle ? undefined : 'ml-auto'}
              onClick={(event: MouseEvent) => open()(event)}
            >
              Open
            </Button>
          )}
        </Show>
        <Show when={props.onRunNow}>
          {(run) => (
            <Button
              size="sm"
              variant="strong"
              disabled={props.busy || props.state === 'running'}
              onClick={() => run()()}
            >
              <Play />
              Run now
            </Button>
          )}
        </Show>
      </CardFooter>
    </Card>
  );
}

/** A routine's schedule in words: `Mondays at 8:00 AM`, `When an email arrives`. */
export function routineSchedule(schedule: ScheduledAction): string | undefined {
  const cron = getCronTrigger(schedule);
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (cron && isCronRepresentable(cron.schedule)) {
    const words = describeCron(
      parseCron(cron.schedule),
      cron.timezone === local ? undefined : cron.timezone
    );
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  const triggers = draftFromSchedule(schedule)?.triggers;
  return triggers?.length ? describeTriggers(triggers) : undefined;
}

/** Where a routine stands, from its stored state. */
export function routineState(schedule: ScheduledAction): RoutineState {
  const status = routineStatus({
    enabled: schedule.enabled,
    isRunning: isClaimActive(schedule.claimed),
    nextRunAt: schedule.next_run_at,
  });
  if (status.kind === 'running') return 'running';
  if (status.kind === 'paused') return 'paused';
  if (status.kind === 'scheduled') return 'active';
  return 'idle';
}

/**
 * A routine a step made or changed, live: its state, schedule and next
 * run, and the controls to pause it, run it now or open it. A viewer who
 * cannot read the routine sees the receipt the agent left instead.
 */
export function RoutineCard(props: {
  id: string;
  action?: CardAction;
  title?: string | null;
  summary?: string | null;
}) {
  const query = useRoutineQuery(() => props.id);
  const preview = useItemPreviewData(() => ({
    id: props.id,
    type: 'routine',
  }));
  const routine = () => (queryReadyGate(query) ? query.data : undefined);
  const toggle = useSetScheduleEnabledMutation({
    onError: (error) =>
      toast.alert('Could not update routine', {
        subtext: getErrorMessage(error),
      }),
  });
  const run = useRunScheduleNowMutation({
    onSuccess: () => toast.success('Routine started'),
    onError: (error) =>
      toast.alert('Could not run routine', {
        subtext: getErrorMessage(error),
      }),
  });

  return (
    <Switch>
      <Match when={routine()}>
        {(schedule) => (
          <RoutineCardView
            name={schedule().name || props.title || 'Routine'}
            badge={
              props.action
                ? {
                    label: actionLabel('routine', props.action),
                    tone: actionTone(props.action),
                  }
                : undefined
            }
            summary={props.summary}
            state={routineState(schedule())}
            schedule={routineSchedule(schedule())}
            nextRun={
              schedule().next_run_at
                ? dayAndTime(new Date(schedule().next_run_at as string))
                : undefined
            }
            onOpen={(event) =>
              preview.onPreviewClick(
                'routine',
                props.id,
                undefined,
                undefined,
                event.shiftKey
              )
            }
            onToggle={() =>
              toggle.mutate({
                scheduleId: props.id,
                enabled: !schedule().enabled,
              })
            }
            onRunNow={() => run.mutate({ scheduleId: props.id })}
            busy={toggle.isPending || run.isPending}
          />
        )}
      </Match>
      <Match when={query.isError}>
        <ReferenceCard
          type="routine"
          id={props.id}
          action={props.action}
          title={props.title}
          summary={props.summary}
        />
      </Match>
      <Match when={true}>
        <Card width="compact" height={72}>
          <SkeletonSingle />
        </Card>
      </Match>
    </Switch>
  );
}
