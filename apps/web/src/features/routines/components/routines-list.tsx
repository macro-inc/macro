import { SearchBar, ViewShell } from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ClockIcon from '@icon/system/regular/clock-clockwise.svg';
import { Button, Tabs } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { RoutineRow } from '../core/types';
import { RoutineListRow, RoutineRowLayout } from './routine-row';

export function RoutinesList(props: {
  rows: RoutineRow[];
  loading: boolean;
  error: boolean;
  pendingId?: string;
  /** False where the host already titles the page, as Settings does. */
  showTitle?: boolean;
  registerSearchFocus?: (focus: () => void) => void;
  onCreate: () => void;
  onOpen: (id: string, history?: boolean) => void;
  onToggle: (row: RoutineRow) => void;
  onRetry: () => void;
}) {
  const [search, setSearch] = createSignal('');
  const [show, setShow] = createSignal<'all' | 'on'>('all');
  let list: HTMLDivElement | undefined;
  const filtered = () =>
    props.rows.filter(
      (row) =>
        (show() === 'all' || row.enabled) &&
        `${row.name} ${row.when} ${row.does}`
          .toLowerCase()
          .includes(search().trim().toLowerCase())
    );
  const groups = () =>
    (
      [
        { key: 'activity', title: 'When something happens' },
        { key: 'schedule', title: 'On a schedule' },
      ] as const
    )
      .map((group) => ({
        ...group,
        rows: filtered().filter((row) => row.group === group.key),
      }))
      .filter((group) => group.rows.length > 0);
  const tabs = (): JSX.Element => (
    <Tabs
      aria-label="Show routines"
      options={[
        { value: 'all', label: 'All', count: props.rows.length },
        {
          value: 'on',
          label: 'On',
          count: props.rows.filter((row) => row.enabled).length,
        },
      ]}
      value={show()}
      onChange={setShow}
    />
  );
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col">
      <Show
        when={!isTouchDevice()}
        fallback={
          <ViewShell.Header>
            <Show when={props.showTitle !== false}>
              <h1 class="mb-3 text-xl font-semibold tracking-[-0.03em] text-ink">
                Routines
              </h1>
            </Show>
            <div class="mb-3">{tabs()}</div>
            <div class="flex min-w-0 items-center justify-between gap-3">
              <SearchBar
                ref={(input) =>
                  props.registerSearchFocus?.(() => {
                    input.focus();
                    input.select();
                  })
                }
                label="Search routines"
                placeholder="Search routines"
                value={search()}
                onValueChange={setSearch}
                onEscape={() => list?.focus()}
                class="max-w-md flex-1"
                hotkey="cmd+f"
              />
              <Button variant="secondary" onClick={props.onCreate}>
                Create Routine
              </Button>
            </div>
          </ViewShell.Header>
        }
      >
        <ListHeader
          title={
            <div class="flex min-w-0 items-center gap-3">
              <h1 class="text-sm font-semibold text-ink">Routines</h1>
              {tabs()}
            </div>
          }
        >
          <ViewCreateButton
            presentation="toolbar"
            aria-label="Create Routine"
            onClick={props.onCreate}
          />
          <ListHeaderSearch
            label="Search routines"
            value={search()}
            onValueChange={setSearch}
            onEscape={() => list?.focus()}
            registerFocus={(focus) => props.registerSearchFocus?.(focus)}
          />
        </ListHeader>
      </Show>
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
        class="@container/routines min-h-0 min-w-0 flex-1 overflow-auto outline-none"
      >
        <div
          role="rowgroup"
          class="sticky top-0 z-1 mx-1 min-w-[760px] bg-panel pt-2 @max-[760px]/routines:hidden"
        >
          <RoutineRowLayout
            role="row"
            class="min-h-8 px-2 text-xs font-medium text-ink-extra-muted"
          >
            <span role="columnheader">Routine</span>
            <span role="columnheader">When</span>
            <span role="columnheader">Then</span>
            <span role="columnheader">Last run</span>
          </RoutineRowLayout>
        </div>
        <div
          role="rowgroup"
          class="min-w-[760px] pb-6 @max-[760px]/routines:min-w-0"
        >
          <For each={groups()}>
            {(group) => (
              <>
                <div
                  role="row"
                  class="mx-1 flex items-center px-2 pb-1.5 pt-4 text-xs font-medium text-ink-extra-muted"
                >
                  <span role="cell" aria-colspan={4} class="flex gap-2">
                    {group.title}
                    <span class="tabular-nums">{group.rows.length}</span>
                  </span>
                </div>
                <For each={group.rows}>
                  {(row) => (
                    <RoutineListRow
                      row={row}
                      pending={props.pendingId === row.id}
                      onOpen={props.onOpen}
                      onToggle={props.onToggle}
                    />
                  )}
                </For>
              </>
            )}
          </For>
        </div>
        <Show when={!filtered().length}>
          <div role="row">
            <div
              role="cell"
              aria-colspan={4}
              class="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm text-ink-muted"
            >
              <ClockIcon class="size-6 text-ink-extra-muted" />
              <p>
                {props.loading
                  ? 'Loading routines…'
                  : props.error
                    ? 'Routines are unavailable'
                    : search().trim() || show() === 'on'
                      ? 'No matching routines'
                      : 'No routines yet'}
              </p>
              <Show when={!props.loading && !props.error && !search().trim()}>
                <p>
                  Create a routine to act on new email, tasks and messages, or
                  on a schedule.
                </p>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
