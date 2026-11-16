import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import { TextNode } from 'lexical';
import { createRoot, createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';
import { FloatingMenuGroup } from '../context/FloatingMenuContext';
import { ACTIONS } from '../plugins/actions/actions';
import { dispatchApplicationCommandSettled } from '../plugins/group-b/command';
import { createMenuOperations } from '../shared/inlineMenu';
import { installNativeMarkdownOverlays } from './installNativeMarkdownOverlays';
import * as actions from './NativeActionsOverlay';
import { createNativeActionMenuHost } from './overlay-hosts/native-actions';
import { createNativeGifContext } from './overlay-hosts/native-gif';
import * as search from './overlay-hosts/native-inline-search';
import { registerNativeMentionSearch } from './overlay-hosts/native-mention-search';

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const previousScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousScrollIntoView)
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      previousScrollIntoView
    );
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
/** jsdom has no ResizeObserver; the table resizer registers one on mount. */
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('ResizeObserver', TestResizeObserver));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'native-actions-lifecycle',
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      onError(error) {
        throw error;
      },
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: native,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'native-actions-lifecycle'
        ),
    }
  );
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: ' body' }],
          },
        ],
      },
    })
  );
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!text) throw new Error('Missing actual text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 0, type: 'text' },
    focus: { key: text.key, offset: 0, type: 'text' },
  });
  runtime.view.focus();
  return { ...runtime, root };
}

for (const cause of [
  undefined,
  null,
  new Error('actions constructor failure'),
]) {
  test(`constructor failure ${String(cause)} retires only its real registrations`, async () => {
    const runtime = mount();
    const errors = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    vi.spyOn(actions, 'NativeActionsOverlay').mockImplementation(() => {
      throw cause;
    });
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const register = runtime.view.registerViewCommand.bind(runtime.view);
    vi.spyOn(runtime.view, 'registerViewCommand').mockImplementation(
      (...args) => {
        const release = vi.fn(register(...args));
        releases.push(release);
        return release;
      }
    );
    const menu = createMenuOperations();
    const releaseMention = registerNativeMentionSearch(runtime.view, menu);
    const installation = installNativeMarkdownOverlays(runtime.view, {
      canEdit: () => true,
      actions: { requests: {} },
    });
    const container = document.createElement('div');
    document.body.append(container);
    let unmount: (() => void) | undefined;
    try {
      const Overlays = installation.Overlays;
      if (!Overlays) throw new Error('Missing actual optional overlay');
      unmount = render(() => <Overlays />, container);
      expect(errors).toHaveBeenCalled();
      expect(releases).toHaveLength(2);
      expect(releases[0]).not.toHaveBeenCalled();
      expect(releases[1]).toHaveBeenCalledTimes(1);
      expect(runtime.port.nativeEnter?.hasListeners()).toBe(true);
      runtime.port.command(CommandCode.InsertText, 0, 0, 'after');
      expect(runtime.root.textContent).toContain('after body');
      installation.dispose();
      installation.dispose();
      unmount();
      unmount = undefined;
      expect(releases[1]).toHaveBeenCalledTimes(1);
      expect(releases[0]).not.toHaveBeenCalled();
    } finally {
      installation.dispose();
      unmount?.();
      releaseMention();
      await runtime.close();
      runtime.root.remove();
      container.remove();
    }
  });
}

test('a later child render failure retires actions while the actual mention binding survives', async () => {
  const runtime = mount();
  const errors = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const [visible, setVisible] = createSignal(false);
  const cause = new Error('actions child render failure');
  vi.spyOn(actions, 'NativeActionsOverlay').mockImplementation(() => (
    <Show when={visible()}>
      {(_visible) => {
        throw cause;
      }}
    </Show>
  ));
  const releaseMention = registerNativeMentionSearch(
    runtime.view,
    createMenuOperations()
  );
  const installation = installNativeMarkdownOverlays(runtime.view, {
    canEdit: () => true,
    actions: { requests: {} },
  });
  const container = document.createElement('div');
  document.body.append(container);
  let unmount: (() => void) | undefined;
  try {
    const Overlays = installation.Overlays;
    if (!Overlays) throw new Error('Missing real overlay');
    unmount = render(() => <Overlays />, container);
    expect(errors).not.toHaveBeenCalled();
    setVisible(true);
    expect(errors).toHaveBeenCalledWith(cause, {
      surface: 'native-action-menu',
    });
    expect(runtime.port.nativeEnter?.hasListeners()).toBe(true);
    runtime.port.command(CommandCode.InsertText, 0, 0, 'after');
    expect(runtime.root.textContent).toContain('after body');
  } finally {
    installation.dispose();
    unmount?.();
    releaseMention();
    await runtime.close();
    runtime.root.remove();
    container.remove();
  }
});

for (const cause of [undefined, null]) {
  test(`synchronous partial registration ${String(cause)} releases its returned handle and permits remount`, async () => {
    const runtime = mount();
    const errors = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    const actionRender = vi.spyOn(actions, 'NativeActionsOverlay');
    const releaseMention = registerNativeMentionSearch(
      runtime.view,
      createMenuOperations()
    );
    const returned: Array<ReturnType<typeof vi.fn>> = [];
    const originalSearch = search.registerNativeInlineSearch;
    const observe = vi
      .spyOn(search, 'registerNativeInlineSearch')
      .mockImplementation((...args) => {
        const release = vi.fn(originalSearch(...args));
        returned.push(release);
        return release;
      });
    const add = runtime.root.addEventListener.bind(runtime.root);
    const fault = vi
      .spyOn(runtime.root, 'addEventListener')
      .mockImplementation((type, listener, options) => {
        add(type, listener, options);
        if (type === 'beforeinput') throw cause;
      });
    const installation = installNativeMarkdownOverlays(runtime.view, {
      canEdit: () => true,
      actions: { requests: {} },
    });
    const container = document.createElement('div');
    document.body.append(container);
    let remounted: ReturnType<typeof installNativeMarkdownOverlays> | undefined;
    let unmount: (() => void) | undefined;
    try {
      // Drag retains its own renderer after the actions listener retires.
      expect(installation.Overlays).toBeDefined();
      const Overlays = installation.Overlays;
      if (!Overlays) throw new Error('Missing independent overlay');
      unmount = render(() => <Overlays />, container);
      expect(actionRender).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith(cause, {
        surface: 'native-action-menu',
      });
      const inputs = vi.spyOn(runtime.port, 'input');
      runtime.root.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '/',
          bubbles: true,
          cancelable: true,
        })
      );
      runtime.root.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: '/',
          bubbles: true,
          cancelable: true,
        })
      );
      expect(actionRender).not.toHaveBeenCalled();
      expect(
        inputs.mock.calls.some(
          ([input]) =>
            input.isEditorApplication() &&
            input.value.name === 'group-a.search-trigger'
        )
      ).toBe(false);
      expect(returned).toHaveLength(1);
      expect(returned[0]).toHaveBeenCalledTimes(1);
      expect(runtime.port.nativeEnter?.hasListeners()).toBe(true);
      fault.mockRestore();
      installation.dispose();
      installation.dispose();
      expect(returned[0]).toHaveBeenCalledTimes(1);
      remounted = installNativeMarkdownOverlays(runtime.view, {
        canEdit: () => true,
        actions: { requests: {} },
      });
      expect(remounted.Overlays).toBeDefined();
      remounted.dispose();
      remounted.dispose();
      expect(returned[1]).toHaveBeenCalledTimes(1);
      expect(runtime.port.nativeEnter?.hasListeners()).toBe(true);
      runtime.port.command(CommandCode.InsertText, 0, 0, 'after');
      expect(runtime.root.textContent).toContain('after body');
    } finally {
      fault.mockRestore();
      observe.mockRestore();
      remounted?.dispose();
      installation.dispose();
      unmount?.();
      container.remove();
      releaseMention();
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('throwing actual actions cleanup preserves the constructor cause and sibling editing', async () => {
  const runtime = mount();
  const primary = new Error('actions constructor primary');
  const secondary = null;
  const errors = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  vi.spyOn(actions, 'NativeActionsOverlay').mockImplementation(() => {
    throw primary;
  });
  const register = runtime.view.registerViewCommand.bind(runtime.view);
  const releases: Array<ReturnType<typeof vi.fn>> = [];
  vi.spyOn(runtime.view, 'registerViewCommand').mockImplementation(
    (...args) => {
      const original = register(...args);
      const index = releases.length;
      const release = vi.fn(() => {
        original();
        if (index === 1) throw secondary;
      });
      releases.push(release);
      return release;
    }
  );
  const releaseMention = registerNativeMentionSearch(
    runtime.view,
    createMenuOperations()
  );
  const installation = installNativeMarkdownOverlays(runtime.view, {
    canEdit: () => true,
    actions: { requests: {} },
  });
  const container = document.createElement('div');
  document.body.append(container);
  let unmount: (() => void) | undefined;
  try {
    const Overlays = installation.Overlays;
    if (!Overlays) throw new Error('Missing overlay');
    unmount = render(() => <Overlays />, container);
    expect(errors.mock.calls[0][0]).toBe(primary);
    expect(errors.mock.calls.some((call) => call[0] === secondary)).toBe(true);
    expect(releases[1]).toHaveBeenCalledTimes(1);
    expect(releases[0]).not.toHaveBeenCalled();
    runtime.port.command(CommandCode.InsertText, 0, 0, 'after');
    expect(runtime.root.textContent).toContain('after body');
    installation.dispose();
    unmount();
    unmount = undefined;
    expect(releases[1]).toHaveBeenCalledTimes(1);
  } finally {
    installation.dispose();
    unmount?.();
    releaseMention();
    await runtime.close();
    runtime.root.remove();
    container.remove();
  }
});

test('the matching registry answers real dependency queries and retires with its host', async () => {
  const runtime = mount();
  const host = createNativeActionMenuHost(
    runtime.view,
    { requestTable() {} },
    () => true
  );
  try {
    expect(host.hasDependencies([])).toBe(true);
    expect(host.hasDependencies([TextNode])).toBe(true);
    host.dispose();
    expect(host.hasDependencies([TextNode])).toBe(false);
  } finally {
    host.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

test('a dependency query failure after healthy projection retires only the mounted actions', async () => {
  const runtime = mount();
  const errors = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const query = runtime.port.query.bind(runtime.port);
  const cause = new Error('later dependency query failure');
  let fail = false;
  let dependencyQueries = 0;
  vi.spyOn(runtime.port, 'query').mockImplementation((request) => {
    if (
      request.kind === 9 &&
      request.text.includes('group-a.action-dependencies')
    ) {
      dependencyQueries += 1;
      if (fail) throw cause;
    }
    return query(request);
  });
  const releaseMention = registerNativeMentionSearch(
    runtime.view,
    createMenuOperations()
  );
  const [ignored, setIgnored] = createSignal<string[]>([]);
  const installation = installNativeMarkdownOverlays(runtime.view, {
    canEdit: () => true,
    actions: {
      requests: {},
      get ignoreActionIds() {
        return ignored();
      },
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  let unmount: (() => void) | undefined;
  try {
    const Overlays = installation.Overlays;
    if (!Overlays) throw new Error('Missing real overlay');
    unmount = render(
      () => (
        <AnalyticsContextProvider>
          <PosthogProvider>
            <FloatingMenuGroup>
              <Overlays />
            </FloatingMenuGroup>
          </PosthogProvider>
        </AnalyticsContextProvider>
      ),
      container
    );
    expect(errors).not.toHaveBeenCalled();
    expect(dependencyQueries).toBeGreaterThan(1);
    fail = true;
    setIgnored(['paragraph']);
    expect(errors).toHaveBeenCalledWith(cause, {
      surface: 'native-action-menu',
    });
    expect(runtime.port.nativeEnter?.hasListeners()).toBe(true);
    runtime.port.command(CommandCode.InsertText, 0, 0, 'after');
    expect(runtime.root.textContent).toContain('after body');
  } finally {
    installation.dispose();
    unmount?.();
    releaseMention();
    await runtime.close();
    runtime.root.remove();
    container.remove();
  }
});

for (const kind of ['task', 'document'] as const) {
  test(`the ${kind} composer receives the exact context after actual search removal`, async () => {
    const runtime = mount();
    const completed = Promise.withResolvers<void>();
    const errors = vi
      .spyOn(Telemetry, 'error')
      .mockImplementation((error) => completed.reject(error));
    const context = {
      sourceDocumentId: 'fixture-document',
      sourceBlockName: 'md',
      disableMentionTracking: true,
    };
    const requestCreation = vi.fn(
      (requestedKind: 'task' | 'document', received: unknown) => {
        try {
          expect(requestedKind).toBe(kind);
          expect(received).toBe(context);
          expect(runtime.executor.session.serializedState()).not.toContain(
            'inline-search'
          );
          expect(runtime.root.textContent).toBe(' body');
          completed.resolve();
        } catch (error) {
          completed.reject(error);
        }
        return true;
      }
    );
    const requests = { requestTable() {}, requestCreation };
    const host = createNativeActionMenuHost(runtime.view, requests, () => true);
    try {
      const trigger = await dispatchApplicationCommandSettled(
        runtime.view,
        'group-a.search-trigger',
        { kind: 'actions' }
      );
      expect(trigger).toMatchObject({ status: 'success', handled: true });
      expect(runtime.executor.session.serializedState()).toContain(
        'inline-search'
      );
      const action = ACTIONS.find((item) => item.id === kind);
      if (!action) throw new Error('Missing actual creation catalog item');
      host.select(action, 'keyboard', context);
      await completed.promise;
      expect(requestCreation).toHaveBeenCalledTimes(1);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      host.dispose();
      await runtime.close();
      runtime.root.remove();
    }
  });
}

test('an unbound request cannot remove the live search before returning', async () => {
  const runtime = mount();
  const host = createNativeActionMenuHost(
    runtime.view,
    { requestTable() {} },
    () => true
  );
  try {
    await dispatchApplicationCommandSettled(
      runtime.view,
      'group-a.search-trigger',
      { kind: 'actions' }
    );
    const before = runtime.executor.session.serializedState();
    const gif = ACTIONS.find((item) => item.id === 'gif');
    if (!gif) throw new Error('Missing source GIF catalog item');
    host.select(gif, 'keyboard');
    expect(runtime.executor.session.serializedState()).toBe(before);
  } finally {
    host.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});

// App composition contract: RustMarkdownEditor passes
// requestGif: () => gifContext.requestOpen() to the native action menu.
test('the slash GIF row is offered and opens the bound picker only with the app request', async () => {
  const runtime = mount();
  const gif = createNativeGifContext();
  gif.bindView(runtime.view);
  const onOpen = vi.fn();
  const gifItem = ACTIONS.find((item) => item.id === 'gif');
  if (!gifItem) throw new Error('Missing source GIF catalog item');
  const disposeRoot = createRoot((dispose) => {
    gif.host.registerPicker(() => true, onOpen);
    return dispose;
  });
  const without = createNativeActionMenuHost(
    runtime.view,
    { requestTable() {} },
    () => true
  );
  const requestGif = vi.fn(() => gif.requestOpen());
  const host = createNativeActionMenuHost(
    runtime.view,
    { requestTable() {}, requestGif },
    () => true
  );
  try {
    expect(without.supports(gifItem)).toBe(false);
    expect(host.supports(gifItem)).toBe(true);
    const trigger = await dispatchApplicationCommandSettled(
      runtime.view,
      'group-a.search-trigger',
      { kind: 'actions' }
    );
    expect(trigger).toMatchObject({ status: 'success', handled: true });
    const generation = runtime.view.mirror.keyGeneration;
    await host.select(gifItem, 'keyboard');
    expect({
      searchGone: !runtime.executor.session
        .serializedState()
        .includes('inline-search'),
      sameGeneration: runtime.view.mirror.keyGeneration === generation,
    }).toEqual({ searchGone: true, sameGeneration: true });
    // The request runs after a microtask, inside its captured span context.
    await vi.waitFor(() => expect(requestGif).toHaveBeenCalledTimes(1));
    expect(requestGif.mock.results).toEqual([{ type: 'return', value: true }]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(runtime.executor.session.serializedState()).not.toContain(
      'inline-search'
    );
  } finally {
    without.dispose();
    host.dispose();
    disposeRoot();
    gif.dispose();
    await runtime.close();
    runtime.root.remove();
  }
});
