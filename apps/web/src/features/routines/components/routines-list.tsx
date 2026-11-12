import { SearchBar, ViewShell } from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ClockIcon from '@icon/system/regular/clock-clockwise.svg';
import { Button, ComposerSurface, Layer, Tabs } from '@ui';
import { type Accessor, createSignal, For, type JSX, Show } from 'solid-js';
import type { RoutineTemplate } from '../core/routine-templates';
import type { RoutineRow } from '../core/types';
import { RoutineListRow, RoutineRowLayout } from './routine-row';
import { RoutineTemplateStrip } from './routine-template-strip';

/**
 * Suggestions on the Routines page: one row above the list, and a Discover
 * tab with all of them.
 */
export type RoutinesDiscover = {
  /** The row above the list on All; `openDiscover` switches to Discover. */
  row(openDiscover: () => void): JSX.Element;
  /** Discover in place of the list, narrowed by the list's search. */
  page(search: Accessor<string>): JSX.Element;
  /** Discover has something the person hasn't seen there. */
  unseen(): boolean;
  /** Discover was opened or left, so what it shows has been seen. */
  onSeen(): void;
};

type ListTab = 'all' | 'on' | 'discover';

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
  /**
   * Templates to start from, above the list; absent where none are offered.
   * Suggestions take their place where they are on.
   */
  templates?: RoutineTemplate[];
  onTemplate?: (template: RoutineTemplate) => void;
  /** Suggestions and the Discover tab; absent where they are off. */
  discover?: RoutinesDiscover;
}) {
  const [search, setSearch] = createSignal('');
  const [show, setShowState] = createSignal<ListTab>('all');
  const showing = (): ListTab =>
    show() === 'discover' && !props.discover ? 'all' : show();
  // Opening or leaving Discover marks what it shows as seen.
  const setShow = (next: ListTab) => {
    if (next === showing()) return;
    if (next === 'discover' || showing() === 'discover')
      props.discover?.onSeen();
    setShowState(next);
  };
  let list: HTMLDivElement | undefined;
  const matches = (row: RoutineRow) =>
    (showing() !== 'on' || row.enabled) &&
    `${row.name} ${row.when} ${row.does}`
      .toLowerCase()
      .includes(search().trim().toLowerCase());
  // A routine shows for its own match or for one of what its runs created.
  const filtered = () =>
    props.rows.filter((row) => matches(row) || row.children.some(matches));
  const [expanded, setExpanded] = createSignal<string[]>([]);
  const isExpanded = (row: RoutineRow) =>
    expanded().includes(row.id) ||
    // A search that finds only a sub-routine shows it.
    (Boolean(search().trim()) && !matches(row));
  const expand = (id: string, open: boolean) =>
    setExpanded((ids) =>
      open
        ? [...ids.filter((other) => other !== id), id]
        : ids.filter((other) => other !== id)
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
        ...(props.discover
          ? [
              {
                value: 'discover' as const,
                label: t('routineSuggestions.discover'),
                dot:
                  showing() !== 'discover' && props.discover.unseen()
                    ? ('violet' as const)
                    : undefined,
              },
            ]
          : []),
      ]}
      value={showing()}
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
      <div class="@container/routines min-h-0 min-w-0 flex-1 overflow-auto">
        <Show
          when={showing() === 'discover' && props.discover}
          fallback={
            <RoutinesTable
              {...props}
              search={search()}
              show={showing()}
              groups={groups()}
              isExpanded={isExpanded}
              onExpand={expand}
              empty={!filtered().length}
              listRef={(element) => (list = element)}
              onOpenDiscover={() => setShow('discover')}
            />
          }
        >
          {(discover) => discover().page(search)}
        </Show>
      </div>
    </div>
  );
}

/** Above the list: the suggestions row, else the templates strip. */
function RoutinesTable(props: {
  rows: RoutineRow[];
  loading: boolean;
  error: boolean;
  pendingId?: string;
  search: string;
  show: ListTab;
  groups: { key: string; title: string; rows: RoutineRow[] }[];
  isExpanded(row: RoutineRow): boolean;
  onExpand(id: string, expanded: boolean): void;
  empty: boolean;
  listRef(element: HTMLDivElement): void;
  onCreate: () => void;
  onOpen: (id: string, history?: boolean) => void;
  onToggle: (row: RoutineRow) => void;
  templates?: RoutineTemplate[];
  onTemplate?: (template: RoutineTemplate) => void;
  discover?: RoutinesDiscover;
  onOpenDiscover(): void;
}) {
  // Both sit above the list, out of the way of a search.
  const above = () => !props.search.trim() && props.show === 'all';
  return (
    <>
      <Show
        when={props.discover}
        fallback={
          <Show
            when={
              above() && (props.templates?.length ?? 0) > 0 && props.onTemplate
            }
          >
            {(onTemplate) => (
              <RoutineTemplateStrip
                templates={props.templates ?? []}
                onUse={onTemplate()}
                onAll={props.onCreate}
              />
            )}
          </Show>
        }
      >
        {(discover) => (
          <Show when={above()}>{discover().row(props.onOpenDiscover)}</Show>
        )}
      </Show>
      <div
        ref={props.listRef}
        role="table"
        aria-label="Routines"
        aria-busy={props.loading}
        tabIndex={-1}
        class="min-w-0 outline-none"
      >
        <div
          role="rowgroup"
          class="sticky top-0 z-1 mx-1 min-w-[760px] bg-panel pt-2 @max-[760px]/routines:hidden"
        >
          <RoutineRowLayout
            role="row"
            class="min-h-8 px-2 text-xs font-medium text-ink-extra-muted"
          >
            <span role="columnheader">Name</span>
            <span role="columnheader">Trigger</span>
            <span role="columnheader">Steps</span>
            <span role="columnheader">Last run</span>
            <span role="columnheader" class="sr-only">
              On
            </span>
          </RoutineRowLayout>
        </div>
        <div
          role="rowgroup"
          class="min-w-[760px] pb-6 @max-[760px]/routines:min-w-0"
        >
          <For each={props.groups}>
            {(group) => (
              <>
                {/* A band like the tasks list's group headers. */}
                <div role="row" class="pb-0.5 pt-3">
                  <div role="cell" aria-colspan={5}>
                    <Layer depth={3}>
                      <ComposerSurface
                        as="div"
                        class="mx-1 flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold tracking-tight text-ink-muted touch:rounded-lg touch:border touch:border-edge-muted touch:bg-surface"
                      >
                        {group.title}
                        <span class="font-normal tabular-nums text-ink-extra-muted">
                          {group.rows.length}
                        </span>
                      </ComposerSurface>
                    </Layer>
                  </div>
                </div>
                <For each={group.rows}>
                  {(row) => (
                    <>
                      <RoutineListRow
                        row={row}
                        pending={props.pendingId === row.id}
                        onOpen={props.onOpen}
                        onToggle={props.onToggle}
                        expanded={props.isExpanded(row)}
                        caretGutter={props.rows.some(
                          (other) => other.children.length > 0
                        )}
                        onExpand={
                          row.children.length > 0
                            ? (open) => props.onExpand(row.id, open)
                            : undefined
                        }
                      />
                      <Show when={props.isExpanded(row)}>
                        <For each={row.children}>
                          {(child) => (
                            <RoutineListRow
                              nested
                              caretGutter
                              row={child}
                              pending={props.pendingId === child.id}
                              onOpen={props.onOpen}
                              onToggle={props.onToggle}
                            />
                          )}
                        </For>
                      </Show>
                    </>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
        <Show when={props.empty}>
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
                    : props.search.trim() || props.show === 'on'
                      ? 'No matching routines'
                      : 'No routines yet'}
              </p>
              <Show
                when={!props.loading && !props.error && !props.search.trim()}
              >
                <p>
                  Create a routine to act on new email, tasks and messages, or
                  on a schedule.
                </p>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </>
  );
}
