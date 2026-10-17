import { SearchBar, ViewShell } from '@app/components/view-shell';
import ClockIcon from '@phosphor/clock-clockwise.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { RoutineRow } from '../core/types';
import { RoutineListRow, RoutineRowLayout } from './routine-row';

export function RoutinesList(props: {
  rows: RoutineRow[];
  loading: boolean;
  error: boolean;
  pendingId?: string;
  searchRef?: (input: HTMLInputElement) => void;
  onCreate: () => void;
  onOpen: (id: string, history?: boolean) => void;
  onToggle: (row: RoutineRow) => void;
  onRetry: () => void;
}) {
  const [search, setSearch] = createSignal('');
  let list: HTMLDivElement | undefined;
  const filtered = () =>
    props.rows.filter((row) =>
      `${row.name} ${row.creator} ${row.target}`
        .toLowerCase()
        .includes(search().trim().toLowerCase())
    );
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col touch:overflow-y-auto touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]">
      <ViewShell.TopBar>
        <h1 class="truncate text-sm font-semibold tracking-[-0.03em] text-ink">
          Routines
        </h1>
      </ViewShell.TopBar>
      <ViewShell.Header class="touch:pt-[calc(var(--mobile-content-inset-top,0px)+0.5rem)]">
        <h1 class="mb-3 text-xl font-semibold tracking-[-0.03em] text-ink not-touch:hidden">
          Routines
        </h1>
        <div class="flex min-w-0 items-center justify-between gap-3">
          <SearchBar
            ref={props.searchRef}
            label="Search routines"
            placeholder="Search routines"
            value={search()}
            onValueChange={setSearch}
            onEscape={() => list?.focus()}
            class="max-w-md flex-1"
            hotkey="cmd+f"
          />
          <Button variant="outline" onClick={props.onCreate}>
            Create Routine
          </Button>
        </div>
      </ViewShell.Header>
      <Show when={props.error}>
        <div
          role="alert"
          class="mx-4 mb-3 flex items-center justify-between gap-2 text-sm text-failure"
        >
          Could not load routines.
          <Button variant="ghost" size="sm" onClick={props.onRetry}>
            Retry
          </Button>
        </div>
      </Show>
      <div
        ref={list}
        role="table"
        aria-label="Routines"
        aria-busy={props.loading}
        tabIndex={-1}
        class="min-h-0 min-w-0 flex-1 overflow-auto outline-none touch:flex-none touch:overflow-visible"
      >
        <div
          role="rowgroup"
          class="sticky top-0 z-1 min-w-[748px] bg-panel touch:hidden"
        >
          <RoutineRowLayout
            role="row"
            class="text-xs font-medium text-ink-extra-muted"
          >
            <span role="columnheader">Routine</span>
            <span role="columnheader">Created by</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Runs with</span>
            <span role="columnheader" class="px-2">
              Enabled
            </span>
          </RoutineRowLayout>
        </div>
        <div role="rowgroup" class="min-w-[748px] touch:min-w-0">
          <For each={filtered()}>
            {(row) => (
              <RoutineListRow
                row={row}
                pending={props.pendingId === row.id}
                onOpen={props.onOpen}
                onToggle={props.onToggle}
              />
            )}
          </For>
        </div>
        <Show when={!filtered().length}>
          <div role="row">
            <div
              role="cell"
              aria-colspan={5}
              class="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm text-ink-muted"
            >
              <ClockIcon class="size-6 text-ink-extra-muted" />
              <p>
                {props.loading
                  ? 'Loading routines…'
                  : props.error
                    ? 'Routines are unavailable'
                    : search().trim()
                      ? 'No matching routines'
                      : 'No routines yet'}
              </p>
              <Show when={!props.loading && !props.error && !search().trim()}>
                <p>
                  Create a routine to run an agent on a schedule or a Macro
                  event.
                </p>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
