import { useSplitLayout } from '@components/app/split-layout/layout';
import BuildingsIcon from '@phosphor/buildings.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import UsersIcon from '@phosphor/users.svg';
import type { useCrmPeopleQuery } from '@queries/crm/people';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { filterAndSortPeople, type PeopleSort } from '../core/crm-people';

const PAGE_SIZE = 50;
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
};
const columns: { label: string; sort?: PeopleSort; class: string }[] = [
  { label: 'Name', sort: 'name', class: 'w-[25%]' },
  { label: 'Email', class: 'w-[26%]' },
  { label: 'Company', sort: 'companyName', class: 'w-[23%]' },
  { label: 'Last contacted', sort: 'lastInteraction', class: 'w-40' },
  { label: 'First contact', sort: 'firstInteraction', class: 'w-40' },
];

export function CrmPeople(props: {
  directory: ReturnType<typeof useCrmPeopleQuery>;
  search: string;
  onSearch: (value: string) => void;
  sort: PeopleSort;
  onSort: (value: PeopleSort) => void;
  descending: boolean;
  onDescending: (value: boolean) => void;
}) {
  const directory = props.directory;
  const { openWithSplit } = useSplitLayout();
  const search = () => props.search;
  const sort = () => props.sort;
  const descending = () => props.descending;
  const [page, setPage] = createSignal(0);
  const people = createMemo(() =>
    filterAndSortPeople(directory.people(), search(), sort(), descending())
  );
  const currentPage = () =>
    Math.min(page(), Math.max(0, Math.ceil(people().length / PAGE_SIZE) - 1));
  const rows = () =>
    people().slice(currentPage() * PAGE_SIZE, (currentPage() + 1) * PAGE_SIZE);
  const loading = () =>
    !directory.query.isError &&
    (directory.query.isFetching || directory.query.hasNextPage);
  const changeSort = (value: PeopleSort) => {
    props.onDescending(
      sort() === value
        ? !descending()
        : value === 'lastInteraction' || value === 'firstInteraction'
    );
    props.onSort(value);
    setPage(0);
  };
  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div class="flex flex-wrap items-center gap-3 border-b border-edge-muted px-4 py-3">
        <div class="flex min-w-40 max-w-sm flex-1 items-center gap-2 rounded-md border border-edge-muted bg-input px-3 py-1.5 focus-within:border-accent">
          <MagnifyingGlassIcon class="size-4 shrink-0 text-ink-muted" />
          <input
            type="search"
            aria-label="Search people"
            value={search()}
            onInput={(event) => {
              props.onSearch(event.currentTarget.value);
              setPage(0);
            }}
            placeholder="Search people, emails, companies…"
            class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
          />
        </div>
        <span class="ml-auto text-xs tabular-nums text-ink-muted" role="status">
          {people().length.toLocaleString()}{' '}
          {people().length === 1 ? 'person' : 'people'}
          <Show when={loading()}> · Loading contacts…</Show>
        </span>
      </div>
      <Show when={directory.query.isError}>
        <div
          class="flex items-center justify-between gap-3 border-b border-edge-muted px-4 py-3 text-sm text-ink-muted"
          role="alert"
        >
          <span>
            Some contacts could not be loaded. The people already loaded are
            still available.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              directory.query.isFetchNextPageError
                ? void directory.query.fetchNextPage()
                : void directory.query.refetch()
            }
          >
            Retry
          </Button>
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-auto">
        <table
          class="w-full min-w-[960px] table-fixed border-collapse text-left text-sm"
          aria-label="People"
        >
          <thead class="sticky top-0 z-1 bg-panel text-xs text-ink-muted">
            <tr>
              <For each={columns}>
                {(column) => (
                  <th
                    scope="col"
                    class={`border-b border-edge-muted px-4 py-3 font-medium ${column.class}`}
                    aria-sort={
                      column.sort === sort()
                        ? descending()
                          ? 'descending'
                          : 'ascending'
                        : undefined
                    }
                  >
                    <Show when={column.sort} fallback={column.label}>
                      {(field) => (
                        <button
                          type="button"
                          class="flex items-center gap-2 hover:text-ink"
                          onClick={() => changeSort(field())}
                          title={
                            field() === 'lastInteraction'
                              ? 'Most recent email interaction, incoming or outgoing'
                              : undefined
                          }
                        >
                          {column.label}
                          <Show when={sort() === field()}>
                            <CaretDownIcon
                              class="size-3"
                              classList={{ 'rotate-180': !descending() }}
                            />
                          </Show>
                        </button>
                      )}
                    </Show>
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(person) => (
                <tr class="group border-b border-edge-muted/60 hover:bg-hover">
                  <td class="px-4 py-2.5">
                    <button
                      type="button"
                      class="flex w-full min-w-0 items-center gap-3 text-left"
                      onClick={(event) =>
                        openWithSplit(
                          { type: 'contact', id: person.id },
                          { activate: true, preferNewSplit: event.shiftKey }
                        )
                      }
                    >
                      <span
                        class="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent"
                        aria-hidden="true"
                      >
                        {(person.name || person.email)
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>
                      <span
                        class="truncate font-medium"
                        title={person.name || person.email}
                      >
                        {person.name || person.email}
                      </span>
                    </button>
                  </td>
                  <td
                    class="truncate px-4 py-2.5 text-ink-muted"
                    title={person.email}
                  >
                    {person.email}
                  </td>
                  <td class="px-4 py-2.5">
                    <button
                      type="button"
                      class="flex max-w-full items-center gap-2 text-ink-muted hover:text-ink"
                      onClick={(event) =>
                        openWithSplit(
                          { type: 'company', id: person.companyId },
                          { activate: true, preferNewSplit: event.shiftKey }
                        )
                      }
                    >
                      <BuildingsIcon class="size-4 shrink-0 text-ink-extra-muted" />
                      <span class="truncate" title={person.companyName}>
                        {person.companyName}
                      </span>
                    </button>
                  </td>
                  <td
                    class="px-4 py-2.5 text-ink-muted"
                    title={new Date(person.lastInteraction).toLocaleString()}
                  >
                    {dateLabel(person.lastInteraction)}
                  </td>
                  <td
                    class="px-4 py-2.5 text-ink-muted"
                    title={new Date(person.firstInteraction).toLocaleString()}
                  >
                    {dateLabel(person.firstInteraction)}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={!rows().length}>
          <div
            class="flex flex-col items-center gap-3 px-6 py-20 text-center"
            role="status"
          >
            <UsersIcon class="size-8 text-ink-extra-muted" />
            <p class="text-sm font-medium">
              {loading()
                ? 'Loading people…'
                : search()
                  ? 'No matching people'
                  : 'No people yet'}
            </p>
            <p class="max-w-sm text-sm text-ink-muted">
              {loading()
                ? 'Your contacts will appear here as they load.'
                : search()
                  ? 'Try a name, email address, or company.'
                  : 'People connected to your CRM companies will appear here.'}
            </p>
          </div>
        </Show>
      </div>
      <div class="flex shrink-0 items-center gap-3 border-t border-edge-muted px-4 py-2 text-xs text-ink-muted">
        <span class="mr-auto">
          {people().length
            ? `${currentPage() * PAGE_SIZE + 1}–${Math.min((currentPage() + 1) * PAGE_SIZE, people().length)} of ${people().length.toLocaleString()}`
            : '0 people'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={currentPage() === 0}
          onClick={() => setPage(currentPage() - 1)}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={(currentPage() + 1) * PAGE_SIZE >= people().length}
          onClick={() => setPage(currentPage() + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
