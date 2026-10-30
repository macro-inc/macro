import { Layout as EntityLayout } from '@entity/core/Layout';
import { Slot as EntitySlot } from '@entity/core/Slot';
import ClockIcon from '@icon/system/regular/clock-clockwise.svg';
import { cn, InlineCheckbox, Layer, Tooltip } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';
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
        'grid min-h-10 min-w-[740px] grid-cols-[2rem_minmax(11rem,1.2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)] items-center gap-2 px-3 touch:min-h-11 @max-[760px]/routines:min-w-0 @max-[760px]/routines:grid-cols-[2rem_minmax(0,1fr)_minmax(0,auto)]',
        props.class
      )}
    >
      {props.children}
    </EntityLayout>
  );
}

function TextCell(props: { text: string; class?: string }) {
  return (
    <EntitySlot
      role="cell"
      class={cn('min-w-0 text-xs text-ink-muted', props.class)}
    >
      <Tooltip label={props.text} class="min-w-0 max-w-full">
        <span class="block truncate">{props.text}</span>
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
      return 'Update the schedule before enabling this routine';
    if (!props.row.enabled && props.row.status === 'Running')
      return 'Wait for the current run to finish before enabling this routine';
    return `${props.row.enabled ? 'Disable' : 'Enable'} ${props.row.name}`;
  };

  return (
    <div
      role="row"
      class={cn(
        'soup-list-entity @container/entity mx-1 min-w-[740px] rounded-xl py-0.5 hover:bg-list-hover focus-within:bg-list-highlighted @max-[760px]/routines:min-w-0',
        !props.row.enabled && 'text-ink-muted'
      )}
      onClick={() => props.onOpen(props.row.id)}
    >
      <RoutineRowLayout class="px-2 text-sm">
        <EntitySlot
          role="cell"
          class="min-w-0"
          onClick={(event) => event.stopPropagation()}
        >
          <Layer depth={2}>
            <Tooltip label={toggleDescription()}>
              <button
                type="button"
                aria-label={`Enabled for ${props.row.name}`}
                aria-pressed={props.row.enabled}
                aria-busy={props.pending}
                disabled={toggleDisabled()}
                class="inline-flex items-center rounded-full p-1.5 outline-none hover:bg-surface/50 focus-visible:ring-2 focus-visible:ring-edge-focus disabled:opacity-50"
                onClick={() => props.onToggle(props.row)}
              >
                <InlineCheckbox checked={props.row.enabled} />
              </button>
            </Tooltip>
          </Layer>
        </EntitySlot>
        <EntitySlot role="cell" class="min-w-0">
          <Tooltip label={props.row.name} class="min-w-0 max-w-full">
            <button
              type="button"
              class="flex min-w-0 max-w-full items-center gap-2 text-left font-medium text-ink outline-none focus-visible:underline"
            >
              <ClockIcon class="size-4 shrink-0 text-ink-muted" />
              <span class="truncate">{props.row.name}</span>
            </button>
          </Tooltip>
        </EntitySlot>
        <TextCell text={props.row.when} class="@max-[760px]/routines:hidden" />
        <TextCell text={props.row.does} class="@max-[760px]/routines:hidden" />
        <EntitySlot role="cell" class="min-w-0 text-xs text-ink-muted">
          <Show when={props.row.lastRun}>
            {(run) => (
              <Tooltip
                label={`${run().at} · ${run().summary}`}
                class="min-w-0 max-w-full"
              >
                <span class="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    class={cn(
                      'size-1.5 shrink-0 rounded-full',
                      run().failed ? 'bg-failure' : 'bg-success'
                    )}
                  />
                  <span class="truncate">
                    {run().at} · {run().summary}
                  </span>
                </span>
              </Tooltip>
            )}
          </Show>
        </EntitySlot>
      </RoutineRowLayout>
    </div>
  );
}
