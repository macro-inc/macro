import '@fontsource-variable/inter';
import '@app/index.css';
import {
  createListController,
  useListInteractions,
} from '@app/components/list';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { Button, Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ListHeader } from '../ListHeader';
import { useViewTabHotkeys } from '../use-view-tab-hotkeys';

const TABS = [
  { value: 'focus', label: 'Focus' },
  { value: 'important', label: 'Signal' },
  { value: 'noise', label: 'Noise' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const THREADS = ['Quarterly plan', 'Lunch on Friday', 'Release notes'];

/**
 * A mailbox over the real hotkey engine, header, tabs and list controller:
 * the header's tabs take Tab and the number keys, and Enter opens a thread
 * that replaces the list, as Email's does, or with `?readingPane` sits
 * beside it in a detail pane. `?width=<px>` narrows the split.
 */
function Fixture() {
  const params = new URLSearchParams(location.search);
  const width = Number(params.get('width'));
  const readingPane = params.has('readingPane');
  useHotKeyRoot();
  const [attachSplit, scopeId] = useHotkeyDOMScope('mail-split');
  const [tab, setTab] = createSignal<Tab>('important');
  const [thread, setThread] = createSignal<string>();
  const [tabs, setTabs] = createSignal<HTMLElement>();

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

  useViewTabHotkeys<Tab>({
    scopeId,
    tabs,
    ids: () => TABS.map((option) => option.value),
    activeId: tab,
    setActiveId: showTab,
    label: (id) => TABS.find((option) => option.value === id)?.label ?? id,
  });

  const mailbox = () => (
    <>
      <ListHeader
        title={
          <div class="flex items-center gap-3">
            <h1 class="text-sm font-medium">Inbox</h1>
            <Tabs
              ref={setTabs}
              aria-label="Inbox view"
              options={[...TABS]}
              value={tab()}
              onChange={showTab}
            />
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

  return (
    <div
      ref={(element) => attachGlobalDOMScope(element)}
      class="min-h-screen bg-page p-8 text-ink"
    >
      <div
        ref={attachSplit}
        tabIndex={-1}
        class="flex gap-4 rounded-xl bg-panel p-4"
        style={width ? { width: `${width}px` } : undefined}
      >
        <Show
          when={readingPane}
          fallback={
            <div data-view-shell-main="" class="flex-1">
              <Show when={thread()} fallback={mailbox()}>
                {(subject) => threadView(subject())}
              </Show>
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
      <output data-testid="tab">{tab()}</output>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
