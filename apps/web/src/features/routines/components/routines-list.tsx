import { SearchBar, ViewShell, ViewSidebar } from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ClockIcon from '@icon/system/regular/clock-clockwise.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, ComposerSurface, Layer, Tabs } from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { canToggleRoutine } from '../core/routine-menu';
import type { RoutineTemplate } from '../core/routine-templates';
import type { RoutineRow } from '../core/types';
import {
  RoutineCardGrid,
  RoutineCardSections,
  RoutinesEmpty,
} from './routine-cards';
import { RoutineSurface } from './routine-editor';
import { RoutineListRow, RoutineRowLayout } from './routine-row';
import { RoutineRowMenu, type RoutineRowMenuActions } from './routine-row-menu';
import { RoutineTemplateStrip } from './routine-template-strip';

/** What the suggestions row needs from the routines list. */
export type RoutinesDiscoverHost = {
  /** The person has no routines yet, so suggestions are where to start. */
  empty: boolean;
  /** A routine a suggestion card turned on, as the list has it. */
  routine(routineId: string): { enabled: boolean; locked: boolean } | undefined;
  /** Switch a routine a suggestion card turned on. */
  onToggle(routineId: string): void;
};

/**
 * Suggestions on the Routines page: one row above the list, and a Discover
 * tab with all of them.
 */
export type RoutinesDiscover = {
  /** The row above the list on All; `openDiscover` switches to Discover. */
  row(openDiscover: () => void, host: RoutinesDiscoverHost): JSX.Element;
  /** Discover in place of the list, narrowed by the list's search. */
  page(search: Accessor<string>): JSX.Element;
  /** Discover has something the person hasn't seen there. */
  unseen(): boolean;
  /** Discover was opened or left, so what it shows has been seen. */
  onSeen(): void;
};

type ListTab = 'all' | 'on' | 'discover';

type Group = {
  key: 'activity' | 'schedule';
  title: string;
  rows: RoutineRow[];
};

export function RoutinesList(props: {
  rows: RoutineRow[];
  loading: boolean;
  error: boolean;
  pendingId?: string;
  /** False where the host already titles the page, as Settings does. */
  showTitle?: boolean;
  mobileHeader?: (focusSearch: () => void) => JSX.Element;
  registerSearchFocus?: (focus: () => void) => void;
  onCreate: () => void;
  onOpen: (id: string, history?: boolean) => void;
  onToggle: (row: RoutineRow) => void;
  onRetry: () => void;
  /** What each row's context menu does; absent where rows have none. */
  menu?: RoutineRowMenuActions;
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
  let focusSearch: (() => void) | undefined;
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
  const groups = (): Group[] =>
    (['activity', 'schedule'] as const)
      .map((key) => ({
        key,
        title:
          key === 'activity'
            ? t('routinesList.activity')
            : t('routinesList.schedule'),
        rows: filtered().filter((row) => row.group === key),
      }))
      .filter((group) => group.rows.length > 0);
  // What the suggestions row asks of the list.
  const discoverHost: RoutinesDiscoverHost = {
    get empty() {
      return props.rows.length === 0 && !props.loading && !props.error;
    },
    routine(id) {
      const row = props.rows.find((other) => other.id === id);
      if (!row) return undefined;
      return {
        enabled: row.enabled,
        locked: !canToggleRoutine(row, props.pendingId === row.id),
      };
    },
    onToggle(id) {
      const row = props.rows.find((other) => other.id === id);
      if (row) props.onToggle(row);
    },
  };
  const tabs = (): JSX.Element => (
    <Tabs
      aria-label={t('routinesList.showLabel')}
      options={[
        {
          value: 'all',
          label: t('routinesList.all'),
          count: props.rows.length,
        },
        {
          value: 'on',
          label: t('routinesList.on'),
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
          <>
            <Show when={props.showTitle !== false}>
              {props.mobileHeader?.(() => focusSearch?.())}
            </Show>
            <ViewShell.Header>
              <div class="mb-3 flex min-w-0 items-center gap-2">
                <ViewSidebar.Toggle action="expand" presentation="pill" />
                {tabs()}
              </div>
              <div class="flex min-w-0 items-center justify-between gap-3">
                <SearchBar
                  ref={(input) => {
                    focusSearch = () => {
                      input.focus();
                      input.select();
                    };
                    props.registerSearchFocus?.(focusSearch);
                  }}
                  label={t('routinesList.search')}
                  placeholder={t('routinesList.search')}
                  value={search()}
                  onValueChange={setSearch}
                  onEscape={() => list?.focus()}
                  class="max-w-md flex-1"
                  hotkey="cmd+f"
                />
                <Show when={props.showTitle === false}>
                  <Button variant="secondary" onClick={props.onCreate}>
                    {t('routinesList.create')}
                  </Button>
                </Show>
              </div>
            </ViewShell.Header>
          </>
        }
      >
        <ListHeader
          title={
            <div class="flex min-w-0 items-center gap-3">
              <h1 class="text-sm font-semibold text-ink">
                {t('routinesList.title')}
              </h1>
              {tabs()}
            </div>
          }
        >
          <ViewCreateButton
            presentation="toolbar"
            aria-label={t('routinesList.create')}
            onClick={props.onCreate}
          />
          <ListHeaderSearch
            label={t('routinesList.search')}
            value={search()}
            onValueChange={setSearch}
            focusResults={() => list?.focus()}
            registerFocus={(focus) => props.registerSearchFocus?.(focus)}
          />
        </ListHeader>
      </Show>
      <Show when={props.error}>
        <div
          role="alert"
          class="mx-4 mb-3 flex items-center justify-between gap-2 text-sm text-failure"
        >
          {t('routinesList.loadFailed')}
          <Button variant="ghost" size="sm" onClick={props.onRetry}>
            {t('routinesList.retry')}
          </Button>
        </div>
      </Show>
      <div class="@container/routines min-h-0 min-w-0 flex-1 overflow-auto">
        <Show
          when={showing() === 'discover' && props.discover}
          fallback={
            // Desktop shows routines as cards; touch keeps the table.
            <Show
              when={!isTouchDevice()}
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
                  discoverHost={discoverHost}
                />
              }
            >
              <RoutineCardsPage
                {...props}
                search={search()}
                show={showing()}
                groups={groups()}
                empty={!filtered().length}
                listRef={(element) => (list = element)}
                onOpenDiscover={() => setShow('discover')}
                discoverHost={discoverHost}
              />
            </Show>
          }
        >
          {(discover) => discover().page(search)}
        </Show>
      </div>
    </div>
  );
}

/** What the page and table share of the list's props. */
type ListBodyProps = {
  rows: RoutineRow[];
  loading: boolean;
  error: boolean;
  pendingId?: string;
  search: string;
  show: ListTab;
  groups: Group[];
  empty: boolean;
  listRef(element: HTMLDivElement): void;
  onCreate: () => void;
  onOpen: (id: string, history?: boolean) => void;
  onToggle: (row: RoutineRow) => void;
  menu?: RoutineRowMenuActions;
  templates?: RoutineTemplate[];
  onTemplate?: (template: RoutineTemplate) => void;
  discover?: RoutinesDiscover;
  discoverHost: RoutinesDiscoverHost;
  onOpenDiscover(): void;
};

/**
 * Above the routines: the suggestions row, else the templates strip. Both
 * stay out of the way of a search and of the On tab.
 */
function RoutinesAbove(props: ListBodyProps) {
  const above = () => !props.search.trim() && props.show === 'all';
  return (
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
        <Show when={above()}>
          {discover().row(props.onOpenDiscover, props.discoverHost)}
        </Show>
      )}
    </Show>
  );
}

/** Where the cards will be while the routines load: a row of each card's shape. */
function RoutineCardsSkeleton() {
  return (
    <ListSkeleton.Root label={t('routinesList.loading')}>
      <RoutineCardGrid>
        <For each={[0, 1, 2]}>
          {() => (
            <li class="min-w-0">
              <RoutineSurface class="flex h-[90px] flex-col justify-center gap-3 px-4">
                <ListSkeleton.Bar class="w-1/2" />
                <ListSkeleton.Bar class="w-3/4" />
              </RoutineSurface>
            </li>
          )}
        </For>
      </RoutineCardGrid>
    </ListSkeleton.Root>
  );
}

/**
 * The desktop page: suggestions, then the routines as cards by what starts
 * them, or where to start when there are none.
 */
function RoutineCardsPage(props: ListBodyProps) {
  const searching = () => Boolean(props.search.trim()) || props.show === 'on';
  return (
    <div
      ref={props.listRef}
      role="region"
      aria-label={t('routinesList.listLabel')}
      aria-busy={props.loading}
      tabIndex={-1}
      class="flex min-w-0 flex-col gap-10 px-12 py-9 outline-none @max-[760px]/routines:px-6 @max-[760px]/routines:py-6"
    >
      <RoutinesAbove {...props} />
      <Switch
        fallback={
          <p class="px-1 py-10 text-center text-sm text-ink-muted">
            {props.error
              ? t('routinesList.unavailable')
              : t('routinesList.noMatches')}
          </p>
        }
      >
        <Match when={!props.empty}>
          <RoutineCardSections
            groups={props.groups}
            pendingId={props.pendingId}
            onOpen={props.onOpen}
            onToggle={props.onToggle}
            menu={props.menu}
          />
        </Match>
        <Match when={props.loading}>
          <RoutineCardsSkeleton />
        </Match>
        <Match when={!props.error && !searching()}>
          <RoutinesEmpty
            onCreate={props.onCreate}
            onOpenDiscover={props.discover ? props.onOpenDiscover : undefined}
          />
        </Match>
      </Switch>
    </div>
  );
}

/** The touch list: a table of routines, grouped by what starts them. */
function RoutinesTable(
  props: ListBodyProps & {
    isExpanded(row: RoutineRow): boolean;
    onExpand(id: string, expanded: boolean): void;
  }
) {
  return (
    <>
      <RoutinesAbove {...props} />
      <div
        ref={props.listRef}
        role="table"
        aria-label={t('routinesList.listLabel')}
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
            <span role="columnheader">{t('routinesList.columnName')}</span>
            <span role="columnheader">{t('routinesList.columnTrigger')}</span>
            <span role="columnheader">{t('routinesList.columnSteps')}</span>
            <span role="columnheader">{t('routinesList.columnLastRun')}</span>
            <span role="columnheader" class="sr-only">
              {t('routinesList.on')}
            </span>
          </RoutineRowLayout>
        </div>
        <div
          role="rowgroup"
          class="min-w-[760px] pb-6 @max-[760px]/routines:min-w-0"
        >
          {/* Keyed by group and routine: each list update makes new row
              objects, and a row that remounted would close its open menu. */}
          <Key each={props.groups} by="key">
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
                        {group().title}
                        <span class="font-normal tabular-nums text-ink-extra-muted">
                          {group().rows.length}
                        </span>
                      </ComposerSurface>
                    </Layer>
                  </div>
                </div>
                <Key each={group().rows} by="id">
                  {(row) => (
                    <>
                      <RoutineRowMenu
                        row={row()}
                        pending={props.pendingId === row().id}
                        onToggle={props.onToggle}
                        actions={props.menu}
                      >
                        <RoutineListRow
                          row={row()}
                          pending={props.pendingId === row().id}
                          onOpen={props.onOpen}
                          onToggle={props.onToggle}
                          expanded={props.isExpanded(row())}
                          caretGutter={props.rows.some(
                            (other) => other.children.length > 0
                          )}
                          onExpand={
                            row().children.length > 0
                              ? (open) => props.onExpand(row().id, open)
                              : undefined
                          }
                        />
                      </RoutineRowMenu>
                      <Show when={props.isExpanded(row())}>
                        <Key each={row().children} by="id">
                          {(child) => (
                            <RoutineRowMenu
                              nested
                              row={child()}
                              pending={props.pendingId === child().id}
                              onToggle={props.onToggle}
                              actions={props.menu}
                            >
                              <RoutineListRow
                                nested
                                caretGutter
                                row={child()}
                                pending={props.pendingId === child().id}
                                onOpen={props.onOpen}
                                onToggle={props.onToggle}
                              />
                            </RoutineRowMenu>
                          )}
                        </Key>
                      </Show>
                    </>
                  )}
                </Key>
              </>
            )}
          </Key>
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
                  ? t('routinesList.loading')
                  : props.error
                    ? t('routinesList.unavailable')
                    : props.search.trim() || props.show === 'on'
                      ? t('routinesList.noMatches')
                      : t('routinesList.noRoutines')}
              </p>
              <Show
                when={!props.loading && !props.error && !props.search.trim()}
              >
                <p>{t('routinesList.createHint')}</p>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </>
  );
}
