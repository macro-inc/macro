import {
  modelProvider,
  ProviderIcon,
} from '@core/component/AI/component/ProviderIcon';
import { EntityIcon } from '@core/component/EntityIcon';
import { Layout as EntityLayout } from '@entity/core/Layout';
import { Slot as EntitySlot } from '@entity/core/Slot';
import ClockIcon from '@phosphor/clock-clockwise.svg';
import { cn, InlineCheckbox, Layer, Tooltip } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';
import type { RoutineRow } from '../core/types';

/** Shared geometry keeps routine properties aligned with their column headers. */
export function RoutineRowLayout(
  props: ParentProps<Pick<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'role'>>
) {
  return (
    <EntityLayout
      role={props.role}
      class={cn(
        'grid min-h-10 min-w-[740px] grid-cols-[minmax(12rem,1fr)_8rem_7rem_minmax(8rem,12rem)_7rem] items-center gap-2 px-3 touch:min-w-0 touch:grid-cols-[minmax(0,1fr)_auto] touch:gap-y-2 touch:py-3',
        props.class
      )}
    >
      {props.children}
    </EntityLayout>
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
      class="soup-list-entity @container/entity mx-1 min-w-[740px] rounded-xl py-0.5 touch:min-w-0 hover:bg-list-hover focus-within:bg-list-highlighted"
      onClick={() => props.onOpen(props.row.id)}
    >
      <RoutineRowLayout class="px-2 text-sm">
        <EntitySlot
          role="cell"
          class="min-w-0 touch:col-start-1 touch:row-start-1"
        >
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
        <EntitySlot
          role="cell"
          class="min-w-0 text-xs text-ink-muted touch:hidden"
        >
          <Tooltip label={props.row.creator} class="max-w-full">
            <span class="truncate">{props.row.creator}</span>
          </Tooltip>
        </EntitySlot>
        <EntitySlot
          role="cell"
          class="min-w-0 text-xs touch:col-start-1 touch:row-start-2"
        >
          <span
            class={cn(
              'inline-flex items-center gap-1.5',
              props.row.status === 'Active' || props.row.status === 'Running'
                ? 'text-accent'
                : 'text-ink-muted'
            )}
          >
            <span
              aria-hidden="true"
              class={cn(
                'size-1.5 rounded-full',
                props.row.status === 'Active' || props.row.status === 'Running'
                  ? 'bg-accent'
                  : 'bg-ink-extra-muted'
              )}
            />
            {props.row.status}
          </span>
        </EntitySlot>
        <EntitySlot role="cell" class="min-w-0 text-xs text-ink-muted">
          <Tooltip label={props.row.target} class="min-w-0 max-w-full">
            <span class="inline-flex min-w-0 max-w-full items-center gap-1.5">
              <Show
                when={modelProvider(props.row.targetModel)}
                fallback={
                  <EntityIcon targetType="chat" size="xs" class="shrink-0" />
                }
              >
                <ProviderIcon
                  model={props.row.targetModel}
                  class="size-3.5 shrink-0"
                />
              </Show>
              <span class="truncate">{props.row.target}</span>
            </span>
          </Tooltip>
        </EntitySlot>
        <EntitySlot
          role="cell"
          class="min-w-0 text-xs touch:col-start-2 touch:row-start-1"
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
                class="inline-flex min-w-0 items-center gap-2 rounded-full px-2 py-1.5 text-ink-muted outline-none hover:bg-surface/50 focus-visible:ring-2 focus-visible:ring-edge-focus disabled:opacity-50"
                onClick={() => props.onToggle(props.row)}
              >
                <InlineCheckbox checked={props.row.enabled} />
                <span>{props.row.enabled ? 'Enabled' : 'Disabled'}</span>
              </button>
            </Tooltip>
          </Layer>
        </EntitySlot>
      </RoutineRowLayout>
    </div>
  );
}
