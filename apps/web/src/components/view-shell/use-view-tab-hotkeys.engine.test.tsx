import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import {
  splitRootScope,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useViewTabHotkeys } from './use-view-tab-hotkeys';

afterEach(() => {
  setActiveScope('global');
  vi.unstubAllGlobals();
});

// The hotkey engine tracks held keys, so every press is released.
function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, ...init });
  fireEvent.keyUp(target, { key, ...init });
}

/** jsdom lays nothing out, so the tabs report a box to count as on screen. */
function onScreen(element: HTMLElement) {
  Object.defineProperty(element, 'getClientRects', {
    value: () => [element.getBoundingClientRect()],
  });
}

/**
 * Two panes with tabs in one split over the real hotkey engine: a list in the
 * sidebar (Recent, Notifications) and a conversation beside it (Messages,
 * Attachments), whose tabs register second, as a preview opening does.
 */
function setup() {
  const [listTab, setListTab] = createSignal('recent');
  const [conversationTab, setConversationTab] = createSignal('messages');
  const [preview, setPreview] = createSignal(true);
  const [listTabs, setListTabs] = createSignal<HTMLElement>();
  let split!: HTMLDivElement;

  function Conversation(props: { scopeId: string }) {
    const [attachMessages] = useHotkeyDOMScope('messages');
    const [tabs, setTabs] = createSignal<HTMLElement>();
    useViewTabHotkeys({
      scopeId: props.scopeId,
      tabs,
      ids: () => ['messages', 'attachments'],
      activeId: conversationTab,
      setActiveId: setConversationTab,
      label: (id) => id,
    });
    return (
      <div ref={onScreen} data-view-shell-main="">
        <div
          ref={(element) => {
            onScreen(element);
            setTabs(element);
          }}
          role="radiogroup"
          aria-label="Channel sections"
        />
        <div
          ref={attachMessages}
          tabIndex={-1}
          aria-label="Messages"
          data-testid="messages"
        />
        <p>A message</p>
      </div>
    );
  }

  function Harness() {
    useHotKeyRoot();
    const [attachSplit, splitScope] = useHotkeyDOMScope('split');
    useViewTabHotkeys({
      scopeId: splitScope,
      tabs: listTabs,
      ids: () => ['recent', 'notifications'],
      activeId: listTab,
      setActiveId: setListTab,
      label: (id) => id,
    });
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div
          ref={(element) => {
            split = element;
            attachSplit(element);
          }}
          tabIndex={-1}
        >
          <div ref={onScreen} data-view-shell-aside="">
            <div
              ref={(element) => {
                onScreen(element);
                setListTabs(element);
              }}
              role="radiogroup"
              aria-label="Home views"
            />
            <div role="grid" aria-label="Notifications" tabIndex={0} />
          </div>
          <Show when={preview()}>
            <Conversation scopeId={splitScope} />
          </Show>
        </div>
      </div>
    );
  }

  const view = render(() => <Harness />);
  return {
    listTab,
    conversationTab,
    closePreview: () => setPreview(false),
    list: () => view.getByRole('grid', { name: 'Notifications' }),
    messages: () => view.getByTestId('messages'),
    message: () => view.getByText('A message'),
    split: () => split,
  };
}

it('gives Tab to the pane that has the keyboard', () => {
  const { listTab, conversationTab, list, messages } = setup();

  list().focus();
  press('Tab');
  expect(listTab()).toBe('notifications');
  expect(conversationTab()).toBe('messages');

  messages().focus();
  press('Tab');
  expect(conversationTab()).toBe('attachments');
  expect(listTab()).toBe('notifications');
  press('1');
  expect(conversationTab()).toBe('messages');
  expect(listTab()).toBe('notifications');
});

it('gives the split itself to the pane last pressed in', () => {
  const { listTab, conversationTab, message, split } = setup();

  fireEvent.pointerDown(message());
  split().focus();
  press('Tab');
  expect(conversationTab()).toBe('attachments');
  expect(listTab()).toBe('recent');
});

it('keeps the list tabs working after the conversation beside it closes', () => {
  const { listTab, closePreview, list } = setup();

  closePreview();
  list().focus();
  press('Tab');
  expect(listTab()).toBe('notifications');
  press('Tab', { shiftKey: true });
  expect(listTab()).toBe('recent');
});

/**
 * A database previewed beside a sidebar without tabs, as Drive shows one: the
 * preview gives its content a hotkey scope of its own, between the tabs and
 * the split, and the split has focus after the item opens.
 */
function previewSetup() {
  // jsdom has no ResizeObserver; the preview's header measures with one.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const [table, setTable] = createSignal('tasks');
  let split!: HTMLDivElement;

  function Database() {
    const [tabs, setTabs] = createSignal<HTMLElement>();
    useViewTabHotkeys({
      scopeId: splitRootScope(useSplitPanelOrThrow()),
      tabs,
      ids: () => ['tasks', 'people'],
      activeId: table,
      setActiveId: setTable,
      label: (id) => id,
    });
    return (
      <div
        ref={(element) => {
          onScreen(element);
          setTabs(element);
        }}
        role="radiogroup"
        aria-label="Database tables"
      />
    );
  }

  function Harness() {
    useHotKeyRoot();
    const [attachSplit, splitScope] = useHotkeyDOMScope('split');
    const [attachPreview, previewScope] = useHotkeyDOMScope('preview-panel');
    // The fields the preview and the tab keys read, set as `SplitPanel` sets them.
    const panel = {
      splitHotkeyScope: splitScope,
      splitRootHotkeyScope: splitScope,
      isPanelActive: () => true,
    } as SplitPanelContextType;
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div
          ref={(element) => {
            split = element;
            attachSplit(element);
          }}
          tabIndex={-1}
        >
          <SplitPanelContext.Provider value={panel}>
            <div ref={onScreen} data-view-shell-aside="">
              <button type="button">Drive</button>
            </div>
            <div ref={onScreen} data-view-shell-detail="">
              <div ref={attachPreview} tabIndex={-1}>
                <SplitHeaderScope.Root
                  splitHotkeyScope={previewScope}
                  isInlinePreview
                >
                  <Database />
                </SplitHeaderScope.Root>
              </div>
            </div>
          </SplitPanelContext.Provider>
        </div>
      </div>
    );
  }

  const view = render(() => <Harness />);
  return {
    table,
    split: () => split,
    sidebarButton: () => view.getByRole('button', { name: 'Drive' }),
  };
}

it('gives Tab on the split itself to tabs inside a preview', () => {
  const { table, split, sidebarButton } = previewSetup();

  split().focus();
  press('Tab');
  expect(table()).toBe('people');
  press('1');
  expect(table()).toBe('tasks');

  sidebarButton().focus();
  press('Tab');
  expect(table()).toBe('tasks');
});
