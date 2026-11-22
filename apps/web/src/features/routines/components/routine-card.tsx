import { t } from '@app/lib/i18n';
import CircleNotchIcon from '@icon/system/regular/circle-notch.svg';
import { Button, cn, ToggleSwitch, Tooltip } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { appearanceColor } from '../../entity-appearance/core/appearance';
import { canToggleRoutine } from '../core/routine-menu';
import type { TriggerKind } from '../core/routine-triggers';
import type { RoutineRow } from '../core/types';
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
    <div class="flex h-4 min-w-0 items-center gap-1.5 pl-11 text-xs leading-4 text-ink-placeholder">
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
 * A routine as a card: its tile, name and what it is for, the "…" menu and
 * switch, and one line on its state. Every state keeps the same height, so a
 * grid of them stays even. Clicking the card opens the routine.
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
    <div
      class={
        'group/routine-card relative flex h-full min-w-0 flex-col gap-2 rounded-xl bg-active px-4 py-3.5 not-touch:hover:shadow-[inset_0_0_0_100vmax_var(--color-hover)] group-data-expanded/routine-menu:shadow-[inset_0_0_0_100vmax_var(--color-hover)]'
      }
    >
      <div class="flex min-w-0 items-center gap-3">
        <RoutineTile row={props.row} />
        <div class="flex min-w-0 flex-1 flex-col">
          {/* The name's hit area covers the card; the controls sit above it. */}
          <button
            type="button"
            class={cn(
              'min-w-0 truncate text-left text-sm font-medium leading-5 outline-none after:absolute after:inset-0 after:rounded-xl after:content-[""] focus-visible:static focus-visible:after:ring-2 focus-visible:after:ring-edge-focus',
              props.row.enabled ? 'text-ink' : 'text-ink-muted'
            )}
            onClick={() => props.onOpen(props.row.id)}
          >
            {props.row.name}
          </button>
          <span
            class={cn(
              'min-w-0 truncate text-[13px] leading-[18px]',
              props.row.enabled ? 'text-ink-muted' : 'text-ink-placeholder'
            )}
          >
            {props.row.description ?? props.row.does}
          </span>
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
      </div>
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
  );
}
