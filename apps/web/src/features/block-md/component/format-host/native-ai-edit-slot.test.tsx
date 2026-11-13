/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import type { DocumentOp } from '@ai-ops/editor';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  type EditorView,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot, createSignal, Show } from 'solid-js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest';
import { NativeBodyToolbar } from './native-body-toolbar';

// The native AI edit slot over a real mounted native session, against Source
// MarkdownPopup's AI edit: admission before the selection query and the
// request, every chunk admitted against the captured origin, the highlight
// bound to that origin, Source keys, and Source's state lifetimes. Only the
// AI service (its completion is driven by the test) and the toast are
// replaced.

type EditRequest = {
  readonly documentId: string;
  readonly prompt: string;
  readonly mode: string;
  readonly onOps: (ops: readonly DocumentOp[]) => void;
};
const service = vi.hoisted(() => ({
  requests: [] as {
    args: EditRequest;
    settle: () => void;
  }[],
  cancelled: [] as string[],
  failures: [] as string[],
}));
vi.mock('../../queries/ai-edit', () => ({
  requestAiEditWithToast: (args: EditRequest, onSettled: () => void) =>
    new Promise<void>((done) => {
      service.requests.push({
        args,
        settle: () => {
          onSettled();
          done();
        },
      });
    }),
  cancelAiEdit: (documentId: string) => service.cancelled.push(documentId),
  hasActiveAiEdit: () => false,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: (message: string) => service.failures.push(message) },
}));

const { createNativeAiEditSlot } = await import('./native-ai-edit-slot');

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

class FixedResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const owned: (() => Promise<void> | void)[] = [];
const getClientRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getClientRects'
);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, run);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  // jsdom has no layout (nor Range.getClientRects): the highlight measures
  // no rects.
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  });
  service.requests.length = 0;
  service.cancelled.length = 0;
  service.failures.length = 0;
});
afterEach(async () => {
  // Every resource is released even when an earlier release throws; the
  // first failure is rethrown afterwards.
  const failures: unknown[] = [];
  const attempt = async (release: () => Promise<void> | void) => {
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  };
  try {
    await attempt(cleanup);
    for (const dispose of owned.splice(0).reverse()) await attempt(dispose);
  } finally {
    frames.clear();
    await attempt(() => {
      if (getClientRects)
        Object.defineProperty(
          Range.prototype,
          'getClientRects',
          getClientRects
        );
      else Reflect.deleteProperty(Range.prototype, 'getClientRects');
    });
    await attempt(() => vi.unstubAllGlobals());
    await attempt(() => vi.restoreAllMocks());
  }
  if (failures.length > 0) throw failures[0];
});

function flushFrames() {
  for (const [id, run] of [...frames]) {
    frames.delete(id);
    run(0);
  }
}

function mountSession(options: { select: boolean } = { select: true }) {
  const root = document.createElement('div');
  document.body.append(root);
  owned.push(() => root.remove());
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'ai-edit-slot',
      theme: {},
      editable: true,
      preset: 'rich',
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
          'ai-edit-slot'
        ),
    }
  );
  owned.push(async () => {
    if (runtime.view.isMounted) await runtime.close();
  });
  const paragraph = (id: string, text: string) => ({
    type: 'paragraph',
    version: 1,
    $: { id },
    children: [{ type: 'text', version: 1, text }],
  });
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          paragraph('alphaId1', 'Alpha beta gamma'),
          paragraph('secondId', 'Second line'),
        ],
      },
    })
  );
  runtime.port.command(CommandCode.ClearHistory);
  if (options.select) runtime.port.command(CommandCode.SelectAll);
  return { ...runtime, root };
}
type Session = ReturnType<typeof mountSession>;

const paragraphs = (session: Session) =>
  [...session.root.querySelectorAll('p')].map((p) => p.textContent ?? '');

/** The slot in its own owned root, rendered in the real toolbar. */
function mountSlot(initial: EditorView) {
  const [view, setView] = createSignal<EditorView | undefined>(initial);
  const [shown, setShown] = createSignal(true);
  const hide = vi.fn(() => setShown(false));
  const focusEditor = vi.fn();
  const parentSpan = Telemetry.span('ai-edit-slot-test');
  const ai = createRoot((dispose) => {
    owned.push(dispose);
    return createNativeAiEditSlot({
      documentId: () => 'doc-1',
      view,
      enabled: () => true,
      parentSpan,
    });
  });
  render(() => (
    <>
      <Show when={shown()}>
        <NativeBodyToolbar
          slots={[ai.slot]}
          interactable={() => true}
          formatTools={() => null}
          hide={hide}
          focusEditor={focusEditor}
          onClosed={ai.popupClosed}
        />
      </Show>
      {ai.Highlight()}
    </>
  ));
  return { hide, show: () => setShown(true), setView, focusEditor };
}

const prompt = () => screen.getByPlaceholderText('Describe changes');
const open = () => fireEvent.click(screen.getByText('AI edit'));
const type = (text: string) =>
  fireEvent.input(prompt(), { target: { value: text } });
const enter = () => fireEvent.keyDown(prompt(), { key: 'Enter' });
/** The highlight's Source stylesheet is mounted only while it paints. */
const highlightShown = () =>
  [...document.querySelectorAll('style')].some((style) =>
    style.textContent?.includes('.ai-edit-highlight {')
  );

test('Enter resolves the native selection and applies the chunks to the captured origin', () => {
  const session = mountSession();
  const { hide } = mountSlot(session.view);
  open();
  type('tighten this');
  enter();
  expect(service.requests).toHaveLength(1);
  const [request] = service.requests;
  expect(request.args.documentId).toBe('doc-1');
  expect(request.args.mode).toBe('fast');
  expect(request.args.prompt).toBe(
    'Request: tighten this\nUser is selecting nodes alphaId1 secondId. Proceed with requested edit'
  );
  expect(hide).toHaveBeenCalledTimes(1);
  request.args.onOps([{ kind: 'setText', node: 'alphaId1', text: 'Tight' }]);
  expect(paragraphs(session)).toEqual(['Tight', 'Second line']);
  request.settle();
});

test('a chunk after the origin rebinds is dropped and the highlight clears', () => {
  const session = mountSession();
  const { setView } = mountSlot(session.view);
  open();
  type('tighten this');
  enter();
  const [request] = service.requests;
  // The running edit keeps its highlight past the popup.
  expect(highlightShown()).toBe(true);
  const generation = session.view.mirror.keyGeneration;
  if (generation === null) throw new Error('Missing key generation');
  // Synthetic stand-in for a mirror re-initialize (a reset or resync).
  vi.spyOn(session.view.mirror, 'keyGeneration', 'get').mockReturnValue(
    generation + 1
  );
  request.args.onOps([{ kind: 'setText', node: 'alphaId1', text: 'Late' }]);
  expect(paragraphs(session)).toEqual(['Alpha beta gamma', 'Second line']);
  // The editor moves to another document: the highlight never paints there.
  setView(mountSession().view);
  expect(highlightShown()).toBe(false);
  request.settle();
});

test('a rebound origin is refused before the selection query and the request; the prompt stays', () => {
  const session = mountSession();
  const { setView } = mountSlot(session.view);
  open();
  type('tighten this');
  const other = mountSession();
  setView(other.view);
  const queries = vi.spyOn(session.view.port, 'query');
  const otherQueries = vi.spyOn(other.view.port, 'query');
  const report = vi.spyOn(Telemetry, 'error');
  enter();
  expect(queries).not.toHaveBeenCalled();
  expect(otherQueries).not.toHaveBeenCalled();
  expect(service.requests).toHaveLength(0);
  expect(report.mock.calls[0]?.[1]).toMatchObject({
    'ai_edit.admission_refusal': 'view-changed',
  });
  expect(prompt()).toBeTruthy();
});

test('lost Edit access is refused before the selection query and the request', () => {
  const session = mountSession();
  mountSlot(session.view);
  open();
  type('tighten this');
  session.executor.run(() =>
    session.executor.session.authorization(
      true,
      false,
      false,
      session.executor.now(),
      Date.now()
    )
  );
  const queries = vi.spyOn(session.view.port, 'query');
  const report = vi.spyOn(Telemetry, 'error');
  enter();
  expect(queries).not.toHaveBeenCalled();
  expect(service.requests).toHaveLength(0);
  expect(report.mock.calls[0]?.[1]).toMatchObject({
    'ai_edit.admission_refusal': 'no-edit-access',
  });
  expect(prompt()).toBeTruthy();
});

test('a throwing refusal reporter is contained: no query, no request, the prompt stays', () => {
  const session = mountSession();
  const { setView } = mountSlot(session.view);
  open();
  type('tighten this');
  setView(mountSession().view);
  vi.spyOn(Telemetry, 'error').mockImplementation(() => {
    throw new Error('reporter down');
  });
  const queries = vi.spyOn(session.view.port, 'query');
  expect(() => enter()).not.toThrow();
  expect(queries).not.toHaveBeenCalled();
  expect(service.requests).toHaveLength(0);
  expect(prompt()).toBeTruthy();
});

test('no native selection shows Source toast and sends nothing', () => {
  const session = mountSession({ select: false });
  mountSlot(session.view);
  open();
  type('tighten this');
  enter();
  expect(service.failures).toEqual(['Could not resolve the selected nodes']);
  expect(service.requests).toHaveLength(0);
});

test('Shift+Enter does not submit; Escape dismisses, refocuses and clears the input', () => {
  const session = mountSession();
  const { focusEditor } = mountSlot(session.view);
  open();
  type('draft');
  fireEvent.keyDown(prompt(), { key: 'Enter', shiftKey: true });
  expect(service.requests).toHaveLength(0);
  fireEvent.keyDown(prompt(), { key: 'Escape' });
  expect(focusEditor).toHaveBeenCalledTimes(1);
  expect(screen.getByText('AI edit')).toBeTruthy();
  // Cleared: reopening and submitting sends nothing.
  open();
  enter();
  expect(service.requests).toHaveLength(0);
});

test('the input survives the popup hiding (Source keeps aiEditInput outside the toolbar)', () => {
  const session = mountSession();
  const { hide, show } = mountSlot(session.view);
  open();
  type('kept');
  hide();
  expect(screen.queryByPlaceholderText('Describe changes')).toBeNull();
  show();
  open();
  // Source's textarea is unbound, so it reopens empty while the input stays.
  expect(prompt()).toHaveProperty('value', '');
  enter();
  expect(service.requests).toHaveLength(1);
  expect(service.requests[0].args.prompt).toContain('Request: kept\n');
  service.requests[0].settle();
});

test('focus waits for a frame and a dismissed prompt cancels it', () => {
  const session = mountSession();
  mountSlot(session.view);
  flushFrames();
  open();
  const queued = [...frames.keys()];
  fireEvent.keyDown(prompt(), { key: 'Escape' });
  // The prompt's pending focus frame is cancelled with it.
  expect(queued.filter((id) => !frames.has(id))).toHaveLength(1);
  open();
  flushFrames();
  expect(document.activeElement).toBe(prompt());
});

test('Escape anywhere cancels the running edit of this document', () => {
  const session = mountSession();
  mountSlot(session.view);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(service.cancelled).toEqual(['doc-1']);
});

test('a disposed slot leaves no window listener behind', async () => {
  const session = mountSession();
  mountSlot(session.view);
  cleanup();
  // Released again by afterEach; every release is idempotent.
  for (const dispose of [...owned].reverse()) await dispose();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(service.cancelled).toEqual([]);
});
