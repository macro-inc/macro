/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { behaviorEditor } from '@core/component/LexicalMarkdown/behavior-inventory/editor';
import { createNativeActionMenuHost } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-actions';
import { queryApplication } from '@core/component/LexicalMarkdown/plugins/group-b/command';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { Telemetry } from '@macro-inc/observability';
import { createRoot, createSignal } from 'solid-js';
import {
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from 'vitest';
import { desktopBodyFormatPopup } from '../views/body-format-popup';
import { createNativeBodyFormattingOverlay } from './format-host/native-overlay';
import { mount, select, state } from './format-host/native-test-fixture';
import {
  lexicalCommandTarget,
  type MarkdownCommandTarget,
  markdownCommandTarget,
  nativeCommandTarget,
  registerMarkdownCommands,
} from './useMarkdownCommands';

// Only the hotkey registry is replaced, to reach the command-menu handlers;
// the document body is a real mounted native session.
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(() => ({ withGroup: vi.fn() })),
  createHotkeyGroup: () => ({ dispose: vi.fn() }),
}));

beforeEach(() => {
  vi.mocked(registerHotkey).mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

const command = (token: string) => {
  const options = vi
    .mocked(registerHotkey)
    .mock.calls.findLast(
      ([registered]) => registered.hotkeyToken === token
    )?.[0];
  if (!options?.keyDownHandler) throw new Error(`Missing command ${token}`);
  return options;
};

function nativeDocument() {
  const [canEdit] = createSignal(true);
  const formatting = createNativeBodyFormattingOverlay({
    composition: () => desktopBodyFormatPopup,
    canEdit,
    alive: () => true,
  });
  onTestFinished(() => formatting.dispose());
  const runtime = mount([formatting.observer]);
  onTestFinished(() => runtime.root.remove());
  onTestFinished(() => runtime.close());
  // Every request the document body supplies (RustMarkdownEditor).
  const actions = createNativeActionMenuHost(
    runtime.view,
    {
      requestTable() {},
      openFileDialog: () => true,
      requestEquation() {},
      requestLink() {},
      requestGif: () => true,
      requestCreation: () => true,
    },
    () => true
  );
  onTestFinished(() => actions.dispose());
  runtime.port.setState(state('label'));
  select(runtime, 'label');
  // The native body as the document state holds it: no Source editor.
  const md: { nativeCommands?: MarkdownCommandTarget } = {
    nativeCommands: nativeCommandTarget({
      formatting: formatting.host,
      actions: () => actions,
      focus: () => runtime.view.focus(),
    }),
  };
  createRoot((dispose) => {
    onTestFinished(dispose);
    registerMarkdownCommands('native-commands', () =>
      markdownCommandTarget(md)
    );
  });
  return runtime;
}

test('Cmd+K Bold formats the native selection', async () => {
  const runtime = nativeDocument();
  const bold = command(TOKENS.md.bold);
  expect(bold.keyDownHandler?.()).toBe(true);
  await vi.waitFor(() =>
    expect(runtime.root.querySelector('strong')?.textContent).toBe('label')
  );
});

test('Cmd+K block actions are listed and turn the native block into a heading', async () => {
  const runtime = nativeDocument();
  const heading = command(TOKENS.md.heading2);
  expect(heading.condition?.()).toBe(true);
  expect(
    typeof heading.hide === 'function' ? heading.hide() : heading.hide
  ).toBe(false);
  expect(heading.keyDownHandler?.()).toBe(true);
  await vi.waitFor(() =>
    expect(runtime.root.querySelector('h2')?.textContent).toBe('label')
  );
});

/** Registered block-action entries (the ones with a condition) and whether each is listed. */
function listedActions() {
  return Object.fromEntries(
    vi
      .mocked(registerHotkey)
      .mock.calls.filter(([options]) => options.condition)
      .map(([options]) => [options.hotkeyToken, options.condition?.()])
  );
}

test('Cmd+K lists the same block entries on native as on Source', () => {
  const source = behaviorEditor();
  createRoot((dispose) => {
    onTestFinished(dispose);
    registerMarkdownCommands('source-commands', () =>
      lexicalCommandTarget(source.editor)
    );
  });
  const sourceListed = listedActions();
  vi.mocked(registerHotkey).mockClear();
  nativeDocument();
  const nativeListed = listedActions();
  expect(Object.keys(nativeListed)).toHaveLength(15);
  // Command-menu only: no block entry binds a real key, so no native key
  // handler can act on these tokens as well.
  expect(
    vi
      .mocked(registerHotkey)
      .mock.calls.filter(([options]) => options.condition)
      .map(([options]) => options.hotkey)
  ).toEqual(Array(15).fill(undefined));
  expect(nativeListed).toEqual(sourceListed);
});

test('Cmd+K Bold at a collapsed caret toggles the typing format, as Source does', async () => {
  const runtime = nativeDocument();
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!text) throw new Error('Missing actual native text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 5, type: 'text' },
    focus: { key: text.key, offset: 5, type: 'text' },
  });
  expect(command(TOKENS.md.bold).keyDownHandler?.()).toBe(true);
  // Source FORMAT_TEXT_COMMAND on a caret toggles the selection format only.
  await vi.waitFor(() => {
    const facts = queryApplication(runtime.view, 'group-b.format-facts', {});
    expect(facts).toMatchObject({ range: { format: 1 } });
  });
  expect(runtime.root.querySelector('strong')).toBeNull();
});

for (const [label, comment] of [
  ['view-only', false],
  ['comment-only', true],
] as const) {
  for (const token of [TOKENS.md.heading2, TOKENS.md.divider]) {
    test(`Cmd+K ${token} after a live ${label} demotion is refused at admission`, async () => {
      const runtime = nativeDocument();
      const errors = vi.spyOn(Telemetry, 'error');
      const admitted = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
      // The session loses edit access; the command menu entry stays installed.
      runtime.executor.run(() =>
        runtime.executor.session.authorization(
          true,
          false,
          comment,
          runtime.executor.now(),
          Date.now()
        )
      );
      const before = runtime.view.query.serializedState();
      expect(command(token).keyDownHandler?.()).toBe(true);
      await vi.waitFor(() => expect(admitted).toHaveBeenCalledTimes(1));
      const settlement = await admitted.mock.results[0]?.value;
      expect(settlement).toMatchObject({ status: 'cancelled' });
      expect(runtime.view.query.serializedState()).toBe(before);
      expect(errors).not.toHaveBeenCalled();
    });
  }
}
