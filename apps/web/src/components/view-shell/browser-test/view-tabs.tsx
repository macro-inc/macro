import '@fontsource-variable/inter';
import '@app/index.css';
import {
  createListController,
  useListInteractions,
} from '@app/components/list';
import {
  appNavigationAttribute,
  hotkeyScopeNeutralAttribute,
} from '@core/dom-selectors';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { Button, Dialog, Dropdown, pressHandlers, Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ListHeader } from '../ListHeader';
import { useViewTabHotkeys } from '../use-view-tab-hotkeys';
import { ViewSidebar } from '../ViewSidebar';

const TABS = [
  { value: 'focus', label: 'Focus' },
  { value: 'important', label: 'Signal' },
  { value: 'noise', label: 'Noise' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const SECTIONS = [
  { value: 'overview', label: 'Overview' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'notes', label: 'Notes' },
] as const;
type Section = (typeof SECTIONS)[number]['value'];

const FOLDERS = ['Inbox', 'Favorites', 'Archived'] as const;
const PROJECT = 'Launch plan';
type Place = (typeof FOLDERS)[number] | typeof PROJECT;

const THREADS = ['Quarterly plan', 'Lunch on Friday', 'Release notes'];

/**
 * A mailbox over the real hotkey engine, header, tabs and list controller:
 * the header's tabs take Tab and the number keys, and Enter opens a thread
 * that replaces the list, as Email's does, or with `?readingPane` sits
 * beside it in a detail pane. `?width=<px>` narrows the split. `?sidebar`
 * adds a real `ViewSidebar` whose folders change what the list shows, as
 * Email's do (only Inbox has tabs), and a project with section tabs of its
 * own, saved-view controls that open a menu and a dialog, beside a stand-in
 * for the app rail, which hands focus back to the split after a press as the
 * real one does.
 */
function Fixture() {
  const params = new URLSearchParams(location.search);
  const width = Number(params.get('width'));
  const readingPane = params.has('readingPane');
  const sidebar = params.has('sidebar');
  useHotKeyRoot();
  const [attachSplit, scopeId] = useHotkeyDOMScope('mail-split');
  let split: HTMLDivElement | undefined;
  const [tab, setTab] = createSignal<Tab>('important');
  const [thread, setThread] = createSignal<string>();
  const [tabs, setTabs] = createSignal<HTMLElement>();
  const [place, setPlace] = createSignal<Place>('Inbox');
  const [section, setSection] = createSignal<Section>('overview');
  const [sectionTabs, setSectionTabs] = createSignal<HTMLElement>();
  const [creating, setCreating] = createSignal(false);
  let createView: HTMLButtonElement | undefined;
  const [projectOpen, setProjectOpen] = createSignal(false);
  let lastFocused: HTMLElement | undefined;

  const list = createListController({
    items: () => THREADS.map((subject) => ({ id: subject })),
    getKey: (item) => item.id,
  });
  useListInteractions({
    controller: list,
    scopeId,
    scrollHandle: () => undefined,
  });
  registerHotkey({
    hotkey: 'enter',
    scopeId,
    description: 'Open thread',
    condition: () => !thread() && list.focus.key() !== undefined,
    keyDownHandler: () => {
      setThread(list.focus.key());
      // Opening leaves focus on the page, as Email's thread does.
      (document.activeElement as HTMLElement | null)?.blur();
      return true;
    },
  });

  // Switching tabs shows that tab's list, leaving an open thread, as in Email.
  const showTab = (next: Tab) => {
    setThread();
    setTab(next);
  };
  const go = (next: Place) => {
    setThread();
    setPlace(next);
  };

  useViewTabHotkeys<Tab>({
    scopeId,
    tabs,
    ids: () => TABS.map((option) => option.value),
    activeId: tab,
    setActiveId: showTab,
    label: (id) => TABS.find((option) => option.value === id)?.label ?? id,
  });
  useViewTabHotkeys<Section>({
    scopeId,
    tabs: sectionTabs,
    ids: () => SECTIONS.map((option) => option.value),
    activeId: section,
    setActiveId: setSection,
    label: (id) => SECTIONS.find((option) => option.value === id)?.label ?? id,
  });

  // The rail's press keeps focus off its button and gives the split back
  // focus as the split focus tracker does: where it is if inside the split,
  // else the element last focused there, else the split itself.
  const returnFocus = () => {
    const active = document.activeElement;
    if (active !== split && split?.contains(active)) return;
    if (lastFocused?.isConnected && split?.contains(lastFocused))
      return lastFocused.focus();
    split?.focus();
  };

  const mailbox = () => (
    <>
      <ListHeader
        title={
          <div class="flex items-center gap-3">
            <h1 class="text-sm font-medium">{place()}</h1>
            <Show when={place() === 'Inbox'}>
              <Tabs
                ref={setTabs}
                aria-label="Inbox view"
                options={[...TABS]}
                value={tab()}
                onChange={showTab}
              />
            </Show>
          </div>
        }
      >
        <Button variant="secondary">Filter</Button>
        <Button variant="secondary">New</Button>
      </ListHeader>
      <div
        role="grid"
        aria-label="Email"
        aria-activedescendant={list.focus.key()}
        tabIndex={0}
        class="mt-2 flex flex-col"
      >
        <For each={THREADS}>
          {(subject) => (
            <div
              id={subject}
              role="row"
              aria-selected={list.focus.key() === subject}
              class="rounded px-2 py-1 aria-selected:bg-hover"
            >
              {subject}
            </div>
          )}
        </For>
      </div>
    </>
  );
  const threadView = (subject: string) => (
    <article aria-label="Thread" class="flex flex-col gap-2">
      <div class="flex gap-2">
        <Button variant="secondary" onClick={() => setThread()}>
          Back
        </Button>
        <Button variant="secondary">Archive</Button>
      </div>
      <h2 class="text-base font-medium">{subject}</h2>
      <p>Here is the plan for next quarter.</p>
      <Button variant="secondary">Reply</Button>
    </article>
  );
  const project = () => (
    <section aria-label="Project" class="flex flex-col gap-2">
      <div class="flex items-center gap-3">
        <h1 class="text-sm font-medium">{PROJECT}</h1>
        <Tabs
          ref={setSectionTabs}
          aria-label="Project sections"
          size="sm"
          options={[...SECTIONS]}
          value={section()}
          onChange={setSection}
        />
      </div>
      <p>Ship the launch checklist.</p>
    </section>
  );
  const main = () => (
    <Show when={place() !== PROJECT} fallback={project()}>
      <Show when={thread()} fallback={mailbox()}>
        {(subject) => threadView(subject())}
      </Show>
    </Show>
  );

  return (
    <div
      ref={(element) => attachGlobalDOMScope(element)}
      class="flex min-h-screen gap-4 bg-page p-8 text-ink"
    >
      <Show when={sidebar}>
        <nav
          {...hotkeyScopeNeutralAttribute}
          {...appNavigationAttribute}
          aria-label="App"
          class="flex flex-col gap-1"
        >
          <Button
            variant="ghost"
            onMouseDown={(event: MouseEvent) => {
              if (event.button !== 0) return;
              event.preventDefault();
              if (place() === PROJECT) go('Inbox');
              returnFocus();
            }}
          >
            Mail
          </Button>
        </nav>
      </Show>
      <div class="flex min-w-0 flex-1 flex-col gap-4">
        <div
          ref={(element) => {
            split = element;
            attachSplit(element);
          }}
          onFocusIn={(event) => {
            if (event.target !== split && event.target instanceof HTMLElement)
              lastFocused = event.target;
          }}
          tabIndex={-1}
          class="flex gap-4 rounded-xl bg-panel p-4"
          style={width ? { width: `${width}px` } : undefined}
        >
          <Show when={sidebar}>
            <div data-view-shell-aside="" class="w-48 shrink-0">
              <ViewSidebar.Root aria-label="Email navigation">
                <ViewSidebar.Nav aria-label="Email tabs">
                  <For each={FOLDERS}>
                    {(folder) => (
                      <ViewSidebar.Item
                        active={place() === folder}
                        {...pressHandlers(() => go(folder))}
                      >
                        {folder}
                      </ViewSidebar.Item>
                    )}
                  </For>
                </ViewSidebar.Nav>
                <ViewSidebar.Nav aria-label="Saved views">
                  <Dropdown placement="bottom-start">
                    <Dropdown.Trigger aria-label="Saved view options">
                      Options
                    </Dropdown.Trigger>
                    <Dropdown.Content>
                      <Dropdown.Item>Rename</Dropdown.Item>
                      <Dropdown.Item>Duplicate</Dropdown.Item>
                    </Dropdown.Content>
                  </Dropdown>
                  <ViewSidebar.Item
                    ref={createView}
                    onClick={() => setCreating(true)}
                  >
                    Create view
                  </ViewSidebar.Item>
                </ViewSidebar.Nav>
                <ViewSidebar.Nav aria-label="Projects">
                  <ViewSidebar.TreeItem
                    active={place() === PROJECT}
                    label={PROJECT}
                    expanded={projectOpen()}
                    onToggle={() => setProjectOpen(!projectOpen())}
                    onClick={() => go(PROJECT)}
                  >
                    {PROJECT}
                  </ViewSidebar.TreeItem>
                </ViewSidebar.Nav>
              </ViewSidebar.Root>
            </div>
          </Show>
          <Show
            when={readingPane}
            fallback={
              <div data-view-shell-main="" class="flex-1">
                {main()}
              </div>
            }
          >
            <div data-view-shell-main="" class="flex-1">
              {mailbox()}
            </div>
            <div data-view-shell-detail="" class="flex-1">
              <Show when={thread()}>{(subject) => threadView(subject())}</Show>
            </div>
          </Show>
        </div>
        <Dialog
          open={creating()}
          onOpenChange={setCreating}
          onCloseAutoFocus={(event) => {
            // Back to its opener, as a dialog's own trigger does.
            event.preventDefault();
            createView?.focus();
          }}
        >
          <div class="flex flex-col gap-2 p-4">
            <h2 class="text-sm font-medium">New view</h2>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
        <output data-testid="tab">{tab()}</output>
        <output data-testid="section">{section()}</output>
      </div>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
