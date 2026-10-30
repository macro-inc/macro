import { Layout as EntityLayout } from '@entity/core/Layout';
import { Slot as EntitySlot } from '@entity/core/Slot';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import EnvelopeIcon from '@icon/system/regular/envelope-simple.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { Badge, cn, ToggleSwitch, Tooltip } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { TriggerKind } from '../core/routine-triggers';
import type { RoutineRow } from '../core/types';

/**
 * Shared geometry keeps routine properties aligned with their column headers.
 * A narrow list (a phone) drops the headers, When and Then.
 */
export function RoutineRowLayout(
  props: ParentProps<Pick<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'role'>>
) {
  return (
    <EntityLayout
      role={props.role}
      class={cn(
        'grid min-h-11 min-w-[760px] grid-cols-[minmax(13rem,1.3fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(10rem,13rem)] items-center gap-3 px-3 @max-[760px]/routines:min-w-0 @max-[760px]/routines:grid-cols-[minmax(0,1fr)_minmax(0,auto)]',
        props.class
      )}
    >
      {props.children}
    </EntityLayout>
  );
}

function TriggerIcon(props: { kind?: TriggerKind }) {
  const icon = () =>
    match(props.kind)
      .with('email', () => EnvelopeIcon)
      .with('task', () => CheckSquareIcon)
      .with('document', () => FileTextIcon)
      .with('channel', () => HashIcon)
      .with('call', () => PhoneIcon)
      .with('schedule', undefined, () => ClockIcon)
      .exhaustive();
  return (
    <Dynamic
      component={icon()}
      aria-hidden="true"
      class="size-3.5 shrink-0 text-ink-muted"
    />
  );
}

function Cell(props: ParentProps<{ label: string; class?: string }>) {
  return (
    <EntitySlot
      role="cell"
      class={cn('min-w-0 text-[13px] text-ink-muted', props.class)}
    >
      <Tooltip label={props.label} class="min-w-0 max-w-full">
        <span class="flex min-w-0 items-center gap-1.5">{props.children}</span>
      </Tooltip>
    </EntitySlot>
  );
}

export function RoutineListRow(props: {
  row: RoutineRow;
  pending: boolean;
  onOpen: (id: string, history?: boolean) => void;
  onToggle: (row: RoutineRow) => void;
}) {
  const toggleDisabled = () =>
    !props.row.editable ||
    props.pending ||
    (!props.row.enabled &&
      (props.row.status === 'Running' || props.row.status === 'Completed'));
  const toggleDescription = () => {
    if (props.pending) return 'Saving…';
    if (!props.row.enabled && props.row.status === 'Completed')
      return 'Update the schedule before turning this routine on';
    if (!props.row.enabled && props.row.status === 'Running')
      return 'Wait for the current run to finish before turning this routine on';
    return `Turn ${props.row.enabled ? 'off' : 'on'}`;
  };
  const doesLabel = () =>
    props.row.ai ? `${props.row.ai} · ${props.row.does}` : props.row.does;

  return (
    <div
      role="row"
      class={cn(
        'soup-list-entity @container/entity mx-1 min-w-[760px] rounded-xl hover:bg-list-hover focus-within:bg-list-highlighted @max-[760px]/routines:min-w-0',
        !props.row.enabled && 'opacity-60'
      )}
      onClick={() => props.onOpen(props.row.id)}
    >
      <RoutineRowLayout class="px-2 text-sm">
        <EntitySlot role="cell" class="flex min-w-0 items-center gap-2.5">
          {/* The switch acts on the routine without opening it. */}
          <span
            class="flex shrink-0"
            onClick={(event) => event.stopPropagation()}
          >
            <Tooltip label={toggleDescription()}>
              <ToggleSwitch
                label={`Enabled for ${props.row.name}`}
                labelClass="sr-only"
                aria-busy={props.pending}
                checked={props.row.enabled}
                disabled={toggleDisabled()}
                onChange={() => props.onToggle(props.row)}
              />
            </Tooltip>
          </span>
          <Tooltip label={props.row.name} class="min-w-0 max-w-full">
            <button
              type="button"
              class="block min-w-0 max-w-full truncate text-left font-medium text-ink outline-none focus-visible:underline"
            >
              {props.row.name}
            </button>
          </Tooltip>
        </EntitySlot>
        <Cell label={props.row.when} class="@max-[760px]/routines:hidden">
          <TriggerIcon kind={props.row.whenKind} />
          <span class="truncate">{props.row.when}</span>
        </Cell>
        <Cell label={doesLabel()} class="@max-[760px]/routines:hidden">
          <Show when={props.row.ai}>
            {(chip) => (
              <Badge size="xs" class="bg-accent-bg text-accent">
                {chip()}
              </Badge>
            )}
          </Show>
          <span class="truncate">{props.row.does}</span>
        </Cell>
        <Show
          when={props.row.lastRun}
          fallback={
            <EntitySlot
              role="cell"
              class="min-w-0 text-[13px] text-ink-extra-muted"
            >
              Not run yet
            </EntitySlot>
          }
        >
          {(run) => (
            <Cell label={`${run().at} · ${run().summary}`}>
              <span
                aria-hidden="true"
                class={cn(
                  'size-2 shrink-0 rounded-full',
                  // Skipped and changed-nothing runs aren't successes.
                  match(run().outcome)
                    .with('succeeded', () => 'bg-success')
                    .with('failed', () => 'bg-failure')
                    .with(
                      'skipped',
                      'nothing',
                      'running',
                      () => 'bg-ink-extra-muted'
                    )
                    .exhaustive()
                )}
              />
              <span class="truncate">
                {run().at}
                {/* A phone shows when it ran; the summary needs the room. */}
                <span class="@max-[760px]/routines:hidden">
                  {' '}
                  · {run().summary}
                </span>
              </span>
            </Cell>
          )}
        </Show>
      </RoutineRowLayout>
    </div>
  );
}
