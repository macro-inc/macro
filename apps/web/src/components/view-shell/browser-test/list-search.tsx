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
import { createMemo, createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { ListHeaderSearch } from '../ListHeader';

const FILES = [
  'Budget 2026',
  'Budget notes',
  'Hiring plan',
  'Launch budget',
  'Roadmap',
];

/** The real field, hotkey engine and list controller, over local rows. */
function Fixture() {
  useHotKeyRoot();
  const [attachSplit, scopeId] = useHotkeyDOMScope('files-split');
  const [search, setSearch] = createSignal('');
  const [tab, setTab] = createSignal('Archived');
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

  return (
    <div
      ref={(element) => attachGlobalDOMScope(element)}
      class="min-h-screen bg-page p-8 text-ink"
    >
      <div ref={attachSplit} class="max-w-2xl rounded-xl bg-panel p-4">
        <div class="flex items-center justify-between gap-2">
          <h1 class="text-sm font-medium" data-testid="tab">
            {tab()}
          </h1>
          <SplitPanelContext.Provider value={panel}>
            <ListHeaderSearch
              label="Search files"
              value={search()}
              onValueChange={setSearch}
              focusResults={(row) => {
                if (row === 'first') list.navigate.toFirst();
                grid.focus();
              }}
              registerFocus={() => {}}
            />
          </SplitPanelContext.Provider>
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
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
