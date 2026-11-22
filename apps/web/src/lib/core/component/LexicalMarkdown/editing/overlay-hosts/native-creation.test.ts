// @vitest-environment jsdom
import { writeFileSync } from 'node:fs';
import type { PopoverSplitOptions } from '@components/app/split-layout/layoutManager';
import {
  EditorInputMsg,
  SessionInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import {
  createInputCommitObservation,
  type InputCommitObservationState,
} from '@macro-inc/lexical-wasm-view';
import {
  commitApplication,
  initializeInputCommitFixture,
  mountInputCommitFixture,
  seedInputCommitFixture,
} from '@macro-inc/lexical-wasm-view/view/input-commit-test-fixture';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import {
  type Span,
  type SpanOptions,
  Telemetry,
} from '@macro-inc/observability';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { CreationComposerCallbacks } from './creation';
import {
  createNativeCreationComposerController,
  matchesCreationCancellation,
} from './native-creation';

// Observe only the popover and mention service boundaries. All native input,
// commit receipts, document-mention construction and output remain real.
const BOUNDARY = vi.hoisted(() => ({
  available: true,
  request: vi.fn<(options: PopoverSplitOptions) => void>(),
  track: vi.fn<(source: string, kind: string, id: string) => Promise<string>>(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () =>
    BOUNDARY.available ? { createPopoverSplit: BOUNDARY.request } : undefined,
}));
vi.mock('@core/signal/mention', () => ({ trackMention: BOUNDARY.track }));

const recorded: unknown[] = [];
let restoreLocks: () => void;
beforeAll(() => {
  restoreLocks = initializeInputCommitFixture();
});
afterAll(() => {
  restoreLocks();
  if (process.env.NATIVE_CREATION_FALLBACK_PROOF)
    writeFileSync(
      process.env.NATIVE_CREATION_FALLBACK_PROOF,
      JSON.stringify(
        recorded,
        (_, value) => (typeof value === 'bigint' ? value.toString() : value),
        2
      )
    );
});
afterEach(() => {
  BOUNDARY.available = true;
  BOUNDARY.request.mockReset();
  BOUNDARY.track.mockReset();
  vi.restoreAllMocks();
});

/** Recording-only output sink: no Source decorator UI or DOM-parity assertion. */
function mountCreationFixture() {
  const runtime = mountInputCommitFixture();
  registerMacroDecoratorViews(runtime.view.registry, {
    'document-mention': () => {
      const span = document.createElement('span');
      span.dataset.creationTestSink = 'no-ui';
      return span;
    },
  });
  return runtime;
}

function recordMention(
  runtime: ReturnType<typeof mountCreationFixture>,
  label: string
) {
  const paragraphKey = runtime.view.node(0)?.children[0];
  const paragraph =
    paragraphKey === undefined ? null : runtime.view.node(paragraphKey);
  const mentionKey = paragraph?.children.find(
    (key) => runtime.view.node(key)?.type === 'document-mention'
  );
  const mention =
    mentionKey === undefined ? null : runtime.view.node(mentionKey);
  expect(mention).not.toBeNull();
  if (!mention) throw new Error('Missing actual native document mention');
  expect(mention.props()).toMatchObject({
    documentId: created.documentId,
    documentName: created.title,
  });
  expect(runtime.view.getElementByKey(mention.key)).not.toBeNull();
  const selection = runtime.view.selection().selection;
  expect(selection.kind).toBe('range');
  if (selection.kind !== 'range')
    throw new Error('Missing native mention caret');
  expect(selection.anchor).toEqual(selection.focus);
  expect(runtime.view.node(selection.anchor.key)).not.toBeNull();
  recorded.push({
    label,
    sink: 'recording-only/no-UI',
    key: mention.key,
    props: mention.props(),
    selection,
    serializedModel: runtime.executor.session.serializedState(),
  });
}

// Fault only the cleanup of the actual creation span. Native execution,
// publication receipts and output remain call-through, never synthesized.
function failCreationSpanCleanup(error: unknown) {
  const original = Telemetry.span.bind(Telemetry);
  const cleanups: Array<() => void> = [];
  function span<T>(
    name: string,
    operation: (span: Span) => Promise<T>
  ): Promise<T>;
  function span<T>(
    name: string,
    options: SpanOptions,
    operation: (span: Span) => Promise<T>
  ): Promise<T>;
  function span(name: string, options?: SpanOptions): Span;
  function span<T>(
    name: string,
    optionsOrOperation?: SpanOptions | ((span: Span) => Promise<T>),
    operation?: (span: Span) => Promise<T>
  ): Span | Promise<T> {
    if (typeof optionsOrOperation === 'function')
      return original(name, (actual) => {
        if (name === 'editor.creation.operation') {
          const end = actual.end.bind(actual);
          const cleanup = vi.spyOn(actual, 'end').mockImplementation(() => {
            end();
            throw error;
          });
          cleanups.push(() => cleanup.mockRestore());
        }
        return optionsOrOperation(actual);
      });
    if (operation) return original(name, optionsOrOperation ?? {}, operation);
    return original(name, optionsOrOperation);
  }
  const intercepted = vi.spyOn(Telemetry, 'span').mockImplementation(span);
  return () => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    intercepted.mockRestore();
  };
}

function failCreationContextCleanup(error: unknown) {
  const original = Telemetry.captureContext.bind(Telemetry);
  const intercepted = vi
    .spyOn(Telemetry, 'captureContext')
    .mockImplementation(() => {
      const context = original();
      return {
        run<T>(operation: () => T): T {
          context.run(operation);
          throw error;
        },
      };
    });
  return () => intercepted.mockRestore();
}

function callbacks(): CreationComposerCallbacks {
  const request = BOUNDARY.request.mock.calls.at(-1)?.[0];
  if (!request || request.content.type !== 'component')
    throw new Error('Missing composer request');
  const start = request.content.params?.onCreateStart;
  const failure = request.content.params?.onCreateFailure;
  const success = request.content.params?.onSuccess;
  if (
    typeof start !== 'function' ||
    typeof failure !== 'function' ||
    typeof success !== 'function'
  )
    throw new Error('Missing composer callbacks');
  return {
    onCreateStart: (value) => start(value),
    onCreateFailure: () => failure(),
    onSuccess: (value) => success(value),
  };
}

const created = {
  documentId: 'fixture-created-document',
  title: 'Created document',
  content: '',
};

test('missing real opener creates no native input', async () => {
  const runtime = mountCreationFixture();
  const controller = createNativeCreationComposerController(runtime.view);
  try {
    BOUNDARY.available = false;
    const input = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
    expect(controller.requestCreation('task')).toBe(false);
    expect(BOUNDARY.request).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
    await runtime.close();
    expect(runtime.view.isMounted).toBe(false);
    runtime.root.remove();
  }
});

test('native current-selection fallback survives local UI editability changes', async () => {
  const runtime = mountCreationFixture();
  const controller = createNativeCreationComposerController(runtime.view);
  try {
    await seedInputCommitFixture(runtime);
    expect(controller.requestCreation('document')).toBe(true);
    const request = callbacks();
    runtime.view.setEditable(false);
    const input = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
    await request.onSuccess(created);
    expect(input).toHaveBeenCalledTimes(1);
    const model = runtime.executor.session.serializedState();
    expect(model).toContain('"type":"document-mention"');
    expect(model).toContain('"documentId":"fixture-created-document"');
    expect(input.mock.calls[0]?.[1]?.mainCommit?.read()).toMatchObject({
      status: 'published',
      mainHandled: true,
    });
    recordMention(runtime, 'healthy readonly-UI fallback');
  } finally {
    controller.dispose();
    await runtime.close();
    expect(runtime.view.isMounted).toBe(false);
    runtime.root.remove();
  }
});

test('tracking rejection stays outside the FIFO and permits a later native fallback', async () => {
  const runtime = mountCreationFixture();
  const controller = createNativeCreationComposerController(runtime.view);
  try {
    await seedInputCommitFixture(runtime);
    const context = {
      sourceDocumentId: 'fixture-origin',
      sourceBlockName: 'md',
    };
    controller.requestCreation('task', context);
    const request = callbacks();
    const error = { kind: 'tracking rejection' };
    BOUNDARY.track.mockRejectedValueOnce(error);
    let caught: { error: unknown } | undefined;
    try {
      await request.onSuccess(created);
    } catch (error) {
      caught = { error };
    }
    expect(caught?.error).toBe(error);
    const input = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
    context.sourceDocumentId = 'fixture-current-origin';
    BOUNDARY.track.mockResolvedValueOnce('fixture-mention');
    await request.onSuccess(created);
    expect(BOUNDARY.track).toHaveBeenLastCalledWith(
      'fixture-current-origin',
      'document',
      'fixture-created-document'
    );
    expect(input).toHaveBeenCalledTimes(1);
    expect(runtime.executor.session.serializedState()).toContain(
      '"mentionUuid":"fixture-mention"'
    );
  } finally {
    controller.dispose();
    await runtime.close();
    expect(runtime.view.isMounted).toBe(false);
    runtime.root.remove();
  }
});

for (const error of [undefined, null, { kind: 'published output failure' }]) {
  for (const cleanup of ['none', 'span', 'context']) {
    test(`real published mention then opaque ${String(error)} with ${cleanup} cleanup holds later operations`, async () => {
      const runtime = mountCreationFixture();
      const controller = createNativeCreationComposerController(runtime.view);
      let release: (() => void) | undefined;
      let stopTelemetryFault: (() => void) | undefined;
      try {
        await seedInputCommitFixture(runtime);
        controller.requestCreation('document');
        const request = callbacks();
        const input = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
        let copiedDuringConsume: unknown;
        release = runtime.view.onCommit(() => {
          copiedDuringConsume = input.mock.calls
            .at(-1)?.[1]
            ?.mainCommit?.read();
          throw error;
        });
        const telemetryError = { kind: 'secondary telemetry cleanup' };
        if (cleanup === 'span')
          stopTelemetryFault = failCreationSpanCleanup(telemetryError);
        if (cleanup === 'context')
          stopTelemetryFault = failCreationContextCleanup(telemetryError);
        let caught: { error: unknown } | undefined;
        try {
          await request.onSuccess(created);
        } catch (error) {
          caught = { error };
        }
        expect(caught).toBeDefined();
        expect(caught?.error).toBe(error);
        expect(copiedDuringConsume).toMatchObject({
          status: 'published',
          mainHandled: true,
        });
        const committed = runtime.executor.session.serializedState();
        expect(committed).toContain('"documentId":"fixture-created-document"');
        recordMention(runtime, 'published then ' + String(error));
        recorded.push({
          phase: 'onCommit',
          cleanup,
          copiedDuringConsume,
          errorKind: error === null ? 'null' : typeof error,
        });
        stopTelemetryFault?.();
        stopTelemetryFault = undefined;
        release();
        release = undefined;
        request.onCreateFailure();
        await request.onSuccess({ ...created, documentId: 'must-not-insert' });
        expect(input).toHaveBeenCalledTimes(1);
        expect(runtime.executor.session.serializedState()).toBe(committed);
        const healthy = createInputCommitObservation();
        const next = await runtime.port.inputSettled(
          () => commitApplication(runtime),
          { mainCommit: healthy }
        );
        expect(next.status).toBe('success');
        expect(healthy.read()).toMatchObject({ status: 'published' });
      } finally {
        stopTelemetryFault?.();
        release?.();
        controller.dispose();
        await runtime.close();
        expect(runtime.view.isMounted).toBe(false);
        runtime.root.remove();
      }
    });
  }
}
test('retired origin still performs Source tracking but admits no native insertion', async () => {
  const runtime = mountCreationFixture();
  const controller = createNativeCreationComposerController(runtime.view);
  try {
    await seedInputCommitFixture(runtime);
    controller.requestCreation('task', {
      sourceDocumentId: 'fixture-origin',
      sourceBlockName: 'md',
    });
    const request = callbacks();
    const before = runtime.executor.session.serializedState();
    const input = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
    controller.dispose();
    BOUNDARY.track.mockResolvedValueOnce('fixture-mention');
    await request.onSuccess(created);
    expect(BOUNDARY.track).toHaveBeenCalledWith(
      'fixture-origin',
      'document',
      'fixture-created-document'
    );
    expect(input).not.toHaveBeenCalled();
    expect(runtime.executor.session.serializedState()).toBe(before);
    expect(controller.requestCreation('task')).toBe(false);
  } finally {
    controller.dispose();
    await runtime.close();
    expect(runtime.view.isMounted).toBe(false);
    runtime.root.remove();
  }
});

// Crafted values exercise only the pure predicate, not native receipt validity
// or authority. Real admission cancellation is covered separately below.
test('pure cancellation classifier rejects uncertainty and mismatched reasons', () => {
  const values: InputCommitObservationState[] = [
    { status: 'unbound' },
    { status: 'pending' },
    { status: 'not-published', entryId: 1n },
    { status: 'published', entryId: 1n, commitId: 1n, mainHandled: true },
    {
      status: 'unavailable',
      reason: 'unsupported-profile',
      receiverNeverCalled: true,
    },
    {
      status: 'unavailable',
      reason: 'receipt-read',
      receiverNeverCalled: false,
    },
    { status: 'not-entered', cause: { status: 'error', error: undefined } },
    { status: 'not-entered', cause: { status: 'cancelled', reason: 'closed' } },
  ];
  for (const value of values)
    expect(matchesCreationCancellation(value, 'entry-admission')).toBe(false);
  expect(
    matchesCreationCancellation(
      {
        status: 'not-entered',
        cause: { status: 'cancelled', reason: 'entry-admission' },
      },
      'entry-admission'
    )
  ).toBe(true);
});

test('actual queued admission cancellation retires this origin without fallback', async () => {
  const runtime = mountCreationFixture();
  const controller = createNativeCreationComposerController(runtime.view);
  try {
    await seedInputCommitFixture(runtime);
    controller.requestCreation('document');
    const request = callbacks();
    const before = runtime.executor.session.serializedState();
    const original = runtime.port.inputSettledIfSessionEdit.bind(runtime.port);
    let result: InputSettlement | undefined;
    let evidence: InputCommitObservationState | undefined;
    const input = vi
      .spyOn(runtime.port, 'inputSettledIfSessionEdit')
      .mockImplementation((factory, options) => {
        let queued: Promise<InputSettlement> | undefined;
        // Real outer executor work keeps the inner Port entry queued. It then
        // drains the actual keep-selection output before evaluating inner admit.
        runtime.executor.run(() => {
          queued = original(factory, options);
          controller.dispose();
          return runtime.executor.session.input(
            SessionInputMsg.encode({
              ...emptyInput(2),
              editor: EditorInputMsg.fromEditorSelection({
                selection: selectionMessage({ kind: 'keep' }),
                change: {},
              }),
            }),
            runtime.executor.now(),
            Date.now()
          );
        });
        if (!queued) throw new Error('Actual queued input was not submitted');
        return queued.then((value) => {
          result = value;
          evidence = options?.mainCommit?.read();
          return value;
        });
      });
    await request.onSuccess(created);
    expect(result).toMatchObject({
      status: 'cancelled',
      reason: 'entry-admission',
    });
    expect(evidence).toMatchObject({
      status: 'not-entered',
      cause: { status: 'cancelled', reason: 'entry-admission' },
    });
    request.onCreateFailure();
    await request.onSuccess({ ...created, documentId: 'must-not-insert' });
    expect(input).toHaveBeenCalledTimes(1);
    expect(runtime.executor.session.serializedState()).toBe(before);
    recorded.push({
      phase: 'actual queued entry-admission cancellation',
      result,
      evidence,
    });
    const healthy = await runtime.port.inputSettled(
      () => commitApplication(runtime),
      {
        mainCommit: createInputCommitObservation(),
      }
    );
    expect(healthy.status).toBe('success');
  } finally {
    controller.dispose();
    await runtime.close();
    expect(runtime.view.isMounted).toBe(false);
    runtime.root.remove();
  }
});

test('synchronous tracer cleanup cannot release the FIFO before a real operation settles', async () => {
  const runtime = mountCreationFixture();
  const controller = createNativeCreationComposerController(runtime.view);
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const originalError = { kind: 'pending real output failure' };
  let release: (() => void) | undefined;
  let stopTelemetryFault: (() => void) | undefined;
  try {
    await seedInputCommitFixture(runtime);
    controller.requestCreation('document');
    const request = callbacks();
    const original = runtime.port.inputSettledIfSessionEdit.bind(runtime.port);
    const input = vi
      .spyOn(runtime.port, 'inputSettledIfSessionEdit')
      .mockImplementation((factory, options) => {
        // Delay delivery of the real outcome, never its native publication or
        // receipt. Observe rejection immediately, before the controlled gate.
        let delivery: Promise<PromiseSettledResult<InputSettlement>>;
        try {
          delivery = original(factory, options).then(
            (value) => ({ status: 'fulfilled', value }),
            (reason) => ({ status: 'rejected', reason })
          );
        } catch (reason) {
          delivery = Promise.resolve({ status: 'rejected', reason });
        }
        entered.resolve();
        return gate.promise.then(async () => {
          const actual = await delivery;
          if (actual.status === 'rejected') throw actual.reason;
          return actual.value;
        });
      });
    release = runtime.view.onCommit(() => {
      throw originalError;
    });
    stopTelemetryFault = failCreationContextCleanup({
      kind: 'context cleanup before outcome',
    });
    let firstFinished = false;
    const first = request.onSuccess(created);
    const observedFirst = Promise.resolve(first).then(
      () => {
        firstFinished = true;
        return { status: 'fulfilled' };
      },
      (error) => {
        firstFinished = true;
        return { status: 'rejected', error };
      }
    );
    await entered.promise;
    expect(input.mock.calls[0]?.[1]?.mainCommit?.read()).toMatchObject({
      status: 'published',
      mainHandled: true,
    });
    release();
    release = undefined;
    let secondFinished = false;
    const second = Promise.resolve(
      request.onSuccess({ ...created, documentId: 'must-not-insert' })
    ).then(() => {
      secondFinished = true;
    });
    // A real independent native input is a completion barrier, not a timer or
    // fake flush. The controller's earlier operation remains behind its gate.
    const independent = await runtime.port.inputSettled(
      () => commitApplication(runtime),
      {
        mainCommit: createInputCommitObservation(),
      }
    );
    expect(independent.status).toBe('success');
    expect(firstFinished).toBe(false);
    expect(secondFinished).toBe(false);
    expect(input).toHaveBeenCalledTimes(1);
    gate.resolve();
    const firstOutcome = await observedFirst;
    expect(firstOutcome).toMatchObject({
      status: 'rejected',
      error: originalError,
    });
    await second;
    expect(input).toHaveBeenCalledTimes(1);
    expect(runtime.executor.session.serializedState()).not.toContain(
      'must-not-insert'
    );
    recorded.push({
      phase: 'tracer cleanup before actual outcome delivery',
      firstFinished,
      secondFinished,
      firstOutcome,
    });
  } finally {
    gate.resolve();
    stopTelemetryFault?.();
    release?.();
    controller.dispose();
    await runtime.close();
    expect(runtime.view.isMounted).toBe(false);
    runtime.root.remove();
  }
});
