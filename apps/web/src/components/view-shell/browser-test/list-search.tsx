import '@fontsource-variable/inter';
import '@app/index.css';
import {
  createListController,
  useListInteractions,
} from '@app/components/list';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ListHeader, ListHeaderSearch } from '../ListHeader';
import { ViewCreateButton } from '../ViewCreateButton';
import { ViewSidebar } from '../ViewSidebar';

const RECENT = ['budget', 'roadmap'];

const HEADER_ACTIONS = ['Filter', 'Group', 'Display', 'Visible'];

const FILES = [
  'Budget 2026',
  'Budget notes',
  'Hiring plan',
  'Launch budget',
  'Roadmap',
];

/**
 * The real field, hotkey engine and list controller, over local rows.
 * `?surface=sidebar` puts the field in a sidebar header, as Home and Chat
 * have it, instead of a list header. `?surface=header&width=<px>` puts it in
 * a real `ListHeader` of that width, beside a full set of header actions;
 * `&plainNew` gives its New no menu caret.
 */
function Fixture() {
  const params = new URLSearchParams(location.search);
  const inSidebar = params.get('surface') === 'sidebar';
  const headerWidth =
    params.get('surface') === 'header' ? Number(params.get('width')) : 0;
  useHotKeyRoot();
  const [attachSplit, scopeId] = useHotkeyDOMScope('files-split');
  const [search, setSearch] = createSignal('');
  const [tab, setTab] = createSignal('Archived');
  // `?wide` is Email's layout: the open field owns the header and lists
  // recent searches above the results.
  const wide = params.has('wide');
  const [open, setOpen] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const recent = createMemo(() =>
    wide && focused()
      ? RECENT.filter((query) => query.includes(search().trim()))
      : []
  );
  let grid!: HTMLDivElement;

  const items = createMemo(() =>
    FILES.filter((name) =>
      name.toLowerCase().includes(search().trim().toLowerCase())
    ).map((name) => ({ id: name }))
  );
  const list = createListController({
    items,
    getKey: (item) => item.id,
  });
  useListInteractions({
    controller: list,
    scopeId,
    scrollHandle: () => undefined,
  });

  // A view's own last Escape step, as Email returns to its default tab.
  registerHotkey({
    hotkey: 'escape',
    scopeId,
    description: 'Back to Inbox',
    condition: () =>
      list.selection.count() === 0 && !search().trim() && tab() !== 'Inbox',
    keyDownHandler: () => {
      setTab('Inbox');
      return true;
    },
    registrationType: 'add',
  });

  const panel = {
    isPanelActive: () => true,
    splitHotkeyScope: scopeId,
  } as unknown as SplitPanelContextType;

  const title = () => (
    <h1 class="text-sm font-medium" data-testid="tab">
      {tab()}
    </h1>
  );
  const field = () => (
    <ListHeaderSearch
      label="Search files"
      value={search()}
      onValueChange={setSearch}
      focusResults={() => grid.focus()}
      registerFocus={() => {}}
      wide={wide}
      onOpenChange={setOpen}
      onFocusChange={setFocused}
      suggestions={
        wide
          ? {
              count: () => recent().length,
              active,
              setActive,
              pick: (index) => setSearch(recent()[index] ?? ''),
            }
          : undefined
      }
    />
  );

  return (
    <div
      ref={(element) => attachGlobalDOMScope(element)}
      class="min-h-screen bg-page p-8 text-ink"
    >
      <div
        ref={attachSplit}
        class="rounded-xl bg-panel p-4"
        classList={{ 'max-w-2xl': !headerWidth }}
      >
        {/* As in a view, the sidebar holds the field and its list. */}
        <div data-view-shell-aside="">
          <Show
            when={headerWidth}
            fallback={
              <div class="flex items-center justify-between gap-2">
                {title()}
                <Show when={!(wide && open())}>
                  <button type="button">New</button>
                </Show>
                <SplitPanelContext.Provider value={panel}>
                  <Show when={inSidebar} fallback={field()}>
                    <div class="w-72">
                      <ViewSidebar.Header
                        searchLabel="Search files"
                        collapseControl={<span />}
                        search={() => (
                          <ViewSidebar.Search
                            label="Search files"
                            value={search()}
                            onValueChange={setSearch}
                            focusResults={() => grid.focus()}
                          />
                        )}
                      >
                        Files
                      </ViewSidebar.Header>
                    </div>
                  </Show>
                </SplitPanelContext.Provider>
              </div>
            }
          >
            {(width) => (
              <div style={{ width: `${width()}px` }}>
                <SplitPanelContext.Provider value={panel}>
                  <ListHeader title={title()}>
                    <For each={HEADER_ACTIONS}>
                      {(name) => <Button variant="secondary">{name}</Button>}
                    </For>
                    <ViewCreateButton
                      presentation="toolbar"
                      menu={!params.has('plainNew')}
                    />
                    {field()}
                  </ListHeader>
                </SplitPanelContext.Provider>
              </div>
            )}
          </Show>
          <div role="listbox" aria-label="Recent searches">
            <For each={recent()}>
              {(query, index) => (
                <div role="option" aria-selected={active() === index()}>
                  {query}
                </div>
              )}
            </For>
          </div>
          <div
            ref={grid}
            role="grid"
            aria-label="Files"
            aria-activedescendant={list.focus.key()}
            tabIndex={0}
            class="mt-3 outline-none"
          >
            <For each={items()}>
              {(item) => (
                <div
                  id={item.id}
                  role="row"
                  aria-selected={list.selection.isSelected(item.id)}
                  class="rounded-md px-2 py-1.5 text-sm"
                  classList={{ 'bg-hover': list.focus.key() === item.id }}
                >
                  <div role="gridcell">{item.id}</div>
                </div>
              )}
            </For>
          </div>
        </div>
        {/* The detail the list opened, beside the sidebar. */}
        <button type="button" class="mt-3 text-sm">
          Open detail
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
