import ClockIcon from '@phosphor/clock-clockwise.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { RoutineRow } from '../core/types';

export function RoutinesList(props: {
  rows: RoutineRow[];
  scope: 'mine' | 'team';
  loading: boolean;
  error: boolean;
  pendingId?: string;
  onScope: (scope: 'mine' | 'team') => void;
  onCreate: () => void;
  onOpen: (id: string, history?: boolean) => void;
  onToggle: (row: RoutineRow) => void;
  onRetry: () => void;
}) {
  const [search, setSearch] = createSignal('');
  const filtered = () =>
    props.rows.filter((row) =>
      `${row.name} ${row.creator} ${row.target}`
        .toLowerCase()
        .includes(search().trim().toLowerCase())
    );
  return (
    <div class="mx-auto w-full max-w-5xl space-y-7 px-5 py-6 sm:px-8 sm:py-9">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-medium text-ink">Routines</h1>
          <p class="mt-1.5 max-w-xl text-sm text-ink-muted">
            Run agents on a schedule or when an event arrives.
          </p>
        </div>
        <Button variant="strong" size="sm" onClick={() => props.onCreate()}>
          <PlusIcon class="size-4" />
          New Routine
        </Button>
      </div>
      <section>
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex gap-1" role="group" aria-label="Routine ownership">
            <For each={['mine', 'team'] as const}>
              {(scope) => (
                <button
                  type="button"
                  aria-pressed={props.scope === scope}
                  class={cn(
                    'rounded-md px-3 py-1.5 text-sm',
                    props.scope === scope
                      ? 'bg-hover text-ink'
                      : 'text-ink-muted hover:bg-hover'
                  )}
                  onClick={() => props.onScope(scope)}
                >
                  {scope === 'mine' ? 'Mine' : 'Team'}
                </button>
              )}
            </For>
          </div>
          <input
            type="search"
            aria-label="Search routines"
            placeholder="Search routines…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="w-56 max-w-full rounded-md border border-edge-muted bg-input px-3 py-1.5 text-sm text-ink placeholder:text-ink-placeholder"
          />
        </div>
        <Show when={props.error}>
          <div
            role="alert"
            class="mb-3 flex items-center justify-between gap-2 text-sm text-failure"
          >
            Could not load routines.
            <Button variant="ghost" size="sm" onClick={props.onRetry}>
              Retry
            </Button>
          </div>
        </Show>
        <div class="overflow-x-auto rounded-lg border border-edge-muted">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-edge-muted text-xs font-normal text-ink-muted">
              <tr>
                <th scope="col" class="px-4 py-3 font-normal">
                  Name
                </th>
                <th
                  scope="col"
                  class="hidden px-4 py-3 font-normal md:table-cell"
                >
                  Created by
                </th>
                <th scope="col" class="px-4 py-3 font-normal">
                  Status
                </th>
                <th
                  scope="col"
                  class="hidden px-4 py-3 font-normal lg:table-cell"
                >
                  Runs with
                </th>
                <th scope="col" class="px-4 py-3">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()}>
                {(row) => (
                  <tr class="border-b border-edge-muted last:border-0 hover:bg-hover/50">
                    <td class="max-w-72 px-4 py-4">
                      <button
                        type="button"
                        class="block max-w-full truncate text-left text-ink hover:underline"
                        title={row.name}
                        onClick={() => props.onOpen(row.id)}
                      >
                        {row.name || 'Untitled routine'}
                      </button>
                      <p
                        class="mt-1 truncate text-xs text-ink-extra-muted"
                        title={row.schedule}
                      >
                        {row.schedule}
                      </p>
                    </td>
                    <td class="hidden px-4 py-4 text-ink-muted md:table-cell">
                      {row.creator}
                    </td>
                    <td class="whitespace-nowrap px-4 py-4">
                      <span
                        class={cn(
                          'inline-flex items-center gap-1.5 text-xs',
                          row.status === 'Active' || row.status === 'Running'
                            ? 'text-accent'
                            : 'text-ink-muted'
                        )}
                      >
                        <span
                          class={cn(
                            'size-1.5 rounded-full',
                            row.status === 'Active' || row.status === 'Running'
                              ? 'bg-accent'
                              : 'bg-ink-extra-muted'
                          )}
                        />
                        {row.status}
                      </span>
                    </td>
                    <td
                      class="hidden max-w-40 truncate px-4 py-4 text-xs text-ink-muted lg:table-cell"
                      title={row.target}
                    >
                      {row.target}
                    </td>
                    <td class="px-3 py-4">
                      <div class="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => props.onOpen(row.id, true)}
                        >
                          History
                        </Button>
                        <Show when={row.editable}>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={
                              props.pendingId === row.id ||
                              (row.status === 'Running' && !row.enabled) ||
                              row.status === 'Completed'
                            }
                            onClick={() => props.onToggle(row)}
                          >
                            {row.enabled ? 'Disable' : 'Enable'}
                          </Button>
                        </Show>
                      </div>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={!filtered().length}>
            <div class="grid justify-items-center gap-2 px-6 py-14 text-center">
              <ClockIcon class="mb-1 size-7 text-ink-extra-muted" />
              <p class="text-sm text-ink">
                {props.loading
                  ? 'Loading routines…'
                  : props.error
                    ? 'Routines are unavailable'
                    : search()
                      ? 'No matching routines'
                      : props.scope === 'team'
                        ? 'No shared routines yet'
                        : 'Your next routine starts here'}
              </p>
              <Show when={!props.loading && !props.error && !search()}>
                <p class="max-w-sm text-xs text-ink-muted">
                  {props.scope === 'team'
                    ? 'Routines shared with your teams appear here. Share a routine from its settings.'
                    : 'Create a briefing, check on a project, or hand recurring work to an agent.'}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => props.onCreate()}
                >
                  Create a routine
                </Button>
              </Show>
            </div>
          </Show>
        </div>
      </section>
    </div>
  );
}
