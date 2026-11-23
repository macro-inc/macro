import { t } from '@app/lib/i18n';
import CircleNotchIcon from '@icon/system/regular/circle-notch.svg';
import { Button, cn, ToggleSwitch, Tooltip } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { appearanceColor } from '../../entity-appearance/core/appearance';
import { canToggleRoutine } from '../core/routine-menu';
import type { TriggerKind } from '../core/routine-triggers';
import type { RoutineRow } from '../core/types';
import { RoutineSurface } from './routine-editor';
import { RoutineIcon } from './routine-icon';
import {
  type RoutineRowMenuActions,
  RoutineRowMenuButton,
} from './routine-row-menu';

/** The tint of a routine's tile with no colour chosen: its trigger's part of the app. */
function triggerTint(kind: TriggerKind | undefined): string {
  return match(kind)
    .with('email', () => 'text-blue')
    .with('task', () => 'text-green')
    .with('document', () => 'text-cyan')
    .with('channel', () => 'text-purple')
    .with('call', () => 'text-red')
    .with('github', () => 'text-pink')
    .with('schedule', undefined, () => 'text-orange')
    .exhaustive();
}

/** Its icon on a 32px tile tinted with its colour; grey while it is off. */
function RoutineTile(props: { row: RoutineRow }) {
  const color = () => appearanceColor(props.row.appearance?.color);
  return (
    <span
      aria-hidden="true"
      class={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg',
        props.row.enabled
          ? 'bg-current/15'
          : 'bg-button-secondary-bg text-ink-placeholder',
        props.row.enabled && !color() && triggerTint(props.row.whenKind)
      )}
      style={props.row.enabled && color() ? { color: color() } : undefined}
    >
      <RoutineIcon
        appearance={props.row.appearance}
        trigger={props.row.whenKind}
        class="size-4"
      />
    </span>
  );
}

/** Why the switch can't be used now, else what it does. */
function toggleDescription(row: RoutineRow, pending: boolean): string {
  if (pending) return t('routinesList.saving');
  if (!row.enabled && row.status === 'Completed')
    return t('routinesList.updateScheduleFirst');
  if (!row.enabled && row.status === 'Running')
    return t('routinesList.waitForRun');
  if (!row.enabled && row.pausedByParent)
    return t('subRoutines.pausedWithParent');
  return row.enabled ? t('routinesList.turnOff') : t('routinesList.turnOn');
}

/** Its latest run in words: how it ended and when. */
function lastRunText(run: NonNullable<RoutineRow['lastRun']>): string {
  return match(run.outcome)
    .with('stopped', () => t('routinesList.stoppedAt', { at: run.at }))
    .with('skipped', () => t('routinesList.skippedAt', { at: run.at }))
    .with('succeeded', 'nothing', 'running', 'failed', () =>
      t('routinesList.ran', { at: run.at })
    )
    .exhaustive();
}

/**
 * One line under the name, the same height in every state: running with
 * Stop, the last run's failure, off, or what starts it and when it last ran.
 */
function RoutineByline(props: {
  row: RoutineRow;
  stopPending: boolean;
  onStop?: () => void;
}) {
  const failed = () =>
    props.row.lastRun?.outcome === 'failed' ? props.row.lastRun : undefined;
  return (
    <div class="flex h-4 min-w-0 items-center gap-1.5 text-xs leading-4 text-ink-placeholder">
      <Switch
        fallback={
          <>
            <Show when={props.row.lastRun}>
              {(run) => (
                <span
                  aria-hidden="true"
                  class={cn(
                    'size-1.5 shrink-0 rounded-full',
                    run().outcome === 'succeeded'
                      ? 'bg-success'
                      : 'bg-ink-extra-muted'
                  )}
                />
              )}
            </Show>
            <span class="min-w-0 truncate">
              {props.row.when}
              {' · '}
              <Show
                when={props.row.lastRun}
                fallback={t('routinesList.notRunYet')}
              >
                {(run) => lastRunText(run())}
              </Show>
              {/* What its runs created opens from its own page. */}
              <Show when={props.row.children.length > 0}>
                {' · '}
                {t('subRoutines.count', { count: props.row.children.length })}
              </Show>
            </span>
          </>
        }
      >
        <Match when={props.row.status === 'Running'}>
          <CircleNotchIcon
            aria-hidden="true"
            class="size-3 shrink-0 animate-spin text-blue motion-reduce:animate-none"
          />
          <span class="min-w-0 flex-1 truncate text-ink-muted">
            {props.stopPending
              ? t('routinesList.stopping')
              : t('routinesList.runningNow')}
          </span>
          <Show when={props.onStop}>
            {(stop) => (
              <Button
                variant="ghost"
                size="xs"
                class="relative z-[1] -my-1 -mr-2"
                disabled={props.stopPending}
                aria-label={t('routinesList.stopName', {
                  name: props.row.name,
                })}
                onClick={(event: MouseEvent) => {
                  event.stopPropagation();
                  stop()();
                }}
              >
                {t('routinesList.stop')}
              </Button>
            )}
          </Show>
        </Match>
        <Match when={!props.row.enabled}>
          <span class="min-w-0 truncate">
            {props.row.when}
            {' · '}
            {t('routinesList.off')}
          </span>
        </Match>
        <Match when={failed()}>
          {(run) => (
            <>
              <span
                aria-hidden="true"
                class="size-1.5 shrink-0 rounded-full bg-failure"
              />
              {/* Above the name's hit area, so hovering it shows the reason. */}
              <Tooltip
                label={run().reason ?? run().summary}
                class="relative z-[1] min-w-0 max-w-full"
              >
                <span class="block min-w-0 truncate text-failure">
                  {t('routinesList.failedAt', { at: run().at })}
                  <Show when={run().reason}>
                    {(reason) => ` · ${reason()}`}
                  </Show>
                </span>
              </Tooltip>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}

/**
 * A routine as a compact card of one fixed size: its tile, its name over one
 * line on its state, the "…" menu and switch. Every state keeps that size, so
 * a grid of them stays even. Clicking the card opens the routine.
 */
export function RoutineCard(props: {
  row: RoutineRow;
  /** Its on/off change is saving. */
  pending: boolean;
  onOpen(id: string): void;
  onToggle(row: RoutineRow): void;
  /** Stop its run in progress; absent where runs can't be stopped. */
  onStop?: (row: RoutineRow) => void;
  stopPending: boolean;
  /** What its "…" menu does; absent where it has none. */
  menu?: RoutineRowMenuActions;
}) {
  return (
    // Discover's card surface, so the two pages' cards match.
    <RoutineSurface class="group/routine-card flex h-16 items-center gap-3 px-3.5">
      <RoutineTile row={props.row} />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        {/* The name's hit area covers the card; the controls sit above it. */}
        <button
          type="button"
          class={cn(
            'min-w-0 truncate text-left text-sm font-medium leading-5 outline-none after:absolute after:inset-0 after:rounded-xl after:content-[""] not-touch:group-hover/routine-card:after:bg-hover group-data-expanded/routine-menu:after:bg-hover focus-visible:static focus-visible:after:ring-2 focus-visible:after:ring-edge-focus',
            props.row.enabled ? 'text-ink' : 'text-ink-muted'
          )}
          onClick={() => props.onOpen(props.row.id)}
        >
          {props.row.name}
        </button>
        <RoutineByline
          row={props.row}
          stopPending={props.stopPending}
          onStop={
            // Only its owner can stop its run.
            props.onStop && props.row.editable
              ? () => props.onStop?.(props.row)
              : undefined
          }
        />
      </div>
      <Show when={props.menu}>
        {(menu) => (
          <span class="relative z-[1] flex shrink-0">
            <RoutineRowMenuButton
              row={props.row}
              pending={props.pending}
              onToggle={props.onToggle}
              actions={menu()}
            />
          </span>
        )}
      </Show>
      <span class="relative z-[1] flex shrink-0">
        <Tooltip label={toggleDescription(props.row, props.pending)}>
          <ToggleSwitch
            label={t('routinesList.enabledFor', { name: props.row.name })}
            labelClass="sr-only"
            aria-busy={props.pending}
            checked={props.row.enabled}
            disabled={!canToggleRoutine(props.row, props.pending)}
            onChange={() => props.onToggle(props.row)}
          />
        </Tooltip>
      </span>
    </RoutineSurface>
  );
}
