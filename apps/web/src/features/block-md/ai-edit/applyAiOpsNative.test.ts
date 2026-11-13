// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import type { DocumentOp } from '@ai-ops/editor';
import { dispatchApplicationCommandSettledIfSessionEdit } from '@core/component/LexicalMarkdown/plugins/group-b/command';
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
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { type AiEditOrigin, applyAiOpsNative } from './applyAiOpsNative';

// The native AI-edit host against Source's app behaviour
// (applyAiOps.source-controls.test.ts, live-20261113): one selection clear,
// then each op in the caller's task; a refused op is reported and skipped and
// the ops after it still apply; the edit succeeds. Named exceptions: a retired
// origin drops the rest silently, and lost Edit access throws (security).

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
        '../../../lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The origin a caller captures: the view at its current generation. */
function originOf(view: EditorView): AiEditOrigin {
  const generation = view.mirror.keyGeneration;
  if (generation === null) throw new Error('Native view has no generation');
  return { view, generation };
}

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const runtime = mountLocalSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'ai-edit-native',
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
          'ai-edit-native'
        ),
    }
  );
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
  // As the app's Source rig does after seeding: the seed is not an undo step.
  runtime.port.command(CommandCode.ClearHistory);
  return { ...runtime, root };
}

type Runtime = ReturnType<typeof mount>;

function paragraphs(runtime: Runtime): string[] {
  return [...runtime.root.querySelectorAll('p')].map(
    (p) => p.textContent ?? ''
  );
}

function undo(runtime: Runtime): void {
  runtime.port.command(CommandCode.Undo);
}

/** A real facade span whose events and attributes the test reads. */
function recordedSpan() {
  const span = Telemetry.span('ai-edit-native-test');
  const event = vi.spyOn(span, 'event');
  const setAttr = vi.spyOn(span, 'setAttr');
  return { span, event, setAttr };
}

const setText = (node: string, text: string): DocumentOp => ({
  kind: 'setText',
  node,
  text,
});
const missedReplace: DocumentOp = {
  kind: 'replaceText',
  node: 'secondId',
  find: 'absent',
  to: 'x',
  scope: { kind: 'all' },
};

async function close(runtime: Runtime): Promise<void> {
  await runtime.close();
  runtime.root.remove();
}

test('applies every op in the caller task and succeeds', async () => {
  const runtime = mount();
  const report = vi.spyOn(Telemetry, 'error');
  const { span, setAttr } = recordedSpan();
  try {
    applyAiOpsNative(
      originOf(runtime.view),
      [
        setText('alphaId1', 'Omega'),
        { kind: 'appendText', node: 'secondId', text: ' (AI)' },
      ],
      span
    );
    // No await between the call and these reads.
    expect(paragraphs(runtime)).toEqual(['Omega', 'Second line (AI)']);
    expect(report).not.toHaveBeenCalled();
    expect(setAttr).toHaveBeenCalledWith('edit.refused_count', 0);
  } finally {
    await close(runtime);
  }
});

test('clears the selection first, even with no ops', async () => {
  const runtime = mount();
  const input = vi.spyOn(runtime.executor.session, 'input');
  const { span } = recordedSpan();
  try {
    applyAiOpsNative(originOf(runtime.view), [], span);
    expect(input).toHaveBeenCalledTimes(1);
    input.mockClear();
    applyAiOpsNative(
      originOf(runtime.view),
      [setText('alphaId1', 'One'), setText('secondId', 'Two')],
      span
    );
    // One clear, then one input per op.
    expect(input).toHaveBeenCalledTimes(3);
  } finally {
    await close(runtime);
  }
});

test('skips a refused op, applies the ops after it and reports it without content', async () => {
  const runtime = mount();
  const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  const { span, event, setAttr } = recordedSpan();
  try {
    applyAiOpsNative(
      originOf(runtime.view),
      [
        setText('alphaId1', 'Omega'),
        missedReplace,
        setText('secondId', 'applied after'),
      ],
      span
    );
    expect(paragraphs(runtime)).toEqual(['Omega', 'applied after']);
    expect(report).toHaveBeenCalledTimes(1);
    const [error, attributes] = report.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('AI op refused');
    // Source's fields, an engine discriminator Source lacks, the typed cause.
    expect(attributes).toEqual({
      'error.source': 'lexical',
      'lexical.editor_type': 'markdown-sync',
      'editor.engine': 'native',
      'ai_edit.refusal_index': 1,
      'ai_edit.refusal_cause': 'findMissed',
    });
    expect(JSON.stringify(report.mock.calls)).not.toMatch(
      /absent|Second line|Omega/
    );
    expect(event).toHaveBeenCalledWith('ai_edit.op_refused', {
      'ai_edit.refusal_index': 1,
      'ai_edit.refusal_cause': 'findMissed',
    });
    expect(setAttr).toHaveBeenCalledWith('edit.refused_count', 1);
  } finally {
    await close(runtime);
  }
});

test('a view retired before entry drops the edit silently', async () => {
  const runtime = mount();
  const report = vi.spyOn(Telemetry, 'error');
  const { span, event } = recordedSpan();
  const closing = runtime.close();
  // Watched from here: closing has inputs of its own.
  const input = vi.spyOn(runtime.executor.session, 'input');
  try {
    expect(() =>
      applyAiOpsNative(
        originOf(runtime.view),
        [setText('alphaId1', 'Omega')],
        span
      )
    ).not.toThrow();
    expect(input).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(event.mock.calls).toEqual([
      [
        'ai_edit.dropped_retired_origin',
        { 'ai_edit.retired_reason': 'unmounted', 'ai_edit.op_count': 1 },
      ],
    ]);
  } finally {
    await closing;
    runtime.root.remove();
  }
});

test('a close started from a listener during op k settles op k and drops the rest once', async () => {
  const runtime = mount();
  const { span, event } = recordedSpan();
  let closing: Promise<void> | undefined;
  const stop = runtime.view.onCommit(() => {
    if (closing === undefined && paragraphs(runtime)[0] === 'Omega')
      closing = runtime.close();
  });
  try {
    expect(() =>
      applyAiOpsNative(
        originOf(runtime.view),
        [setText('alphaId1', 'Omega'), setText('secondId', 'never')],
        span
      )
    ).not.toThrow();
    expect(closing).toBeDefined();
    expect(paragraphs(runtime)).not.toContain('never');
    expect(
      event.mock.calls.filter(
        ([name]) => name === 'ai_edit.dropped_retired_origin'
      )
    ).toHaveLength(1);
  } finally {
    stop();
    await closing;
    runtime.root.remove();
  }
});

test('a helper failure on a mounted view keeps its own error', async () => {
  const runtime = mount();
  const { span, event } = recordedSpan();
  let caught: unknown;
  try {
    // Inside the executor's own drain the synchronous input is refused as busy:
    // a real failure, not a retired origin.
    runtime.executor.run(() => {
      try {
        applyAiOpsNative(
          originOf(runtime.view),
          [setText('alphaId1', 'Omega')],
          span
        );
      } catch (error) {
        caught = error;
      }
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(String(caught)).toMatch(/Session executor is busy/);
    expect(
      event.mock.calls.filter(
        ([name]) => name === 'ai_edit.dropped_retired_origin'
      )
    ).toHaveLength(0);
  } finally {
    await close(runtime);
  }
});

test('another view still applies after one retires', async () => {
  const retired = mount();
  const live = mount();
  const { span } = recordedSpan();
  try {
    const closing = retired.close();
    applyAiOpsNative(
      originOf(retired.view),
      [setText('alphaId1', 'gone')],
      span
    );
    await closing;
    applyAiOpsNative(originOf(live.view), [setText('alphaId1', 'Omega')], span);
    expect(paragraphs(live)[0]).toBe('Omega');
  } finally {
    retired.root.remove();
    await close(live);
  }
});

test('a later chunk after the origin rebinds is dropped, never retargeted (named difference)', async () => {
  const runtime = mount();
  const { span, event } = recordedSpan();
  try {
    // The submit captures the origin once; the service streams chunks to it.
    const origin = originOf(runtime.view);
    applyAiOpsNative(origin, [setText('alphaId1', 'First chunk')], span);
    expect(paragraphs(runtime)[0]).toBe('First chunk');
    // Synthetic stand-in for a mirror re-initialize, the only path that
    // replaces the key generation (a reset or resync rebinds the view).
    vi.spyOn(runtime.view.mirror, 'keyGeneration', 'get').mockReturnValue(
      origin.generation + 1
    );
    expect(runtime.view.mirror.keyGeneration).not.toBe(origin.generation);
    applyAiOpsNative(origin, [setText('alphaId1', 'Second chunk')], span);
    expect(paragraphs(runtime)).toEqual(['First chunk', 'Second line']);
    expect(
      event.mock.calls.filter(
        ([name]) => name === 'ai_edit.dropped_retired_origin'
      )
    ).toEqual([
      [
        'ai_edit.dropped_retired_origin',
        { 'ai_edit.retired_reason': 'rebound', 'ai_edit.op_count': 1 },
      ],
    ]);
  } finally {
    await close(runtime);
  }
});

test('lost Edit access mid-edit keeps the prefix and fails (named security difference)', async () => {
  const runtime = mount();
  const session = runtime.executor.session;
  const { span, event } = recordedSpan();
  let revoked = false;
  const stop = runtime.view.onCommit(() => {
    if (revoked || paragraphs(runtime)[0] !== 'Omega') return;
    revoked = true;
    // Queued behind op 1 in the same drain, before op 2's admission.
    runtime.executor.run(() =>
      session.authorization(
        true,
        false,
        false,
        runtime.executor.now(),
        Date.now()
      )
    );
  });
  try {
    expect(() =>
      applyAiOpsNative(
        originOf(runtime.view),
        [setText('alphaId1', 'Omega'), setText('secondId', 'never')],
        span
      )
    ).toThrow('AI edit lost Edit access');
    expect(paragraphs(runtime)).toEqual(['Omega', 'Second line']);
    expect(event).toHaveBeenCalledWith('ai_edit.access_lost', {
      'ai_edit.op_count': 2,
    });
  } finally {
    stop();
    await close(runtime);
  }
});

test('the same origin cannot start a second edit while one applies; another can', async () => {
  const runtime = mount();
  const other = mount();
  const { span } = recordedSpan();
  let nested: unknown;
  let otherApplied = false;
  const stop = runtime.view.onCommit(() => {
    if (nested !== undefined || paragraphs(runtime)[0] !== 'Omega') return;
    try {
      applyAiOpsNative(
        originOf(runtime.view),
        [setText('secondId', 'nested')],
        span
      );
      nested = 'applied';
    } catch (error) {
      nested = error;
    }
    applyAiOpsNative(
      originOf(other.view),
      [setText('alphaId1', 'other')],
      span
    );
    otherApplied = paragraphs(other)[0] === 'other';
  });
  try {
    applyAiOpsNative(
      originOf(runtime.view),
      [setText('alphaId1', 'Omega'), setText('secondId', 'Final')],
      span
    );
    expect(String(nested)).toMatch(/A native AI edit is already applying here/);
    expect(otherApplied).toBe(true);
    expect(paragraphs(runtime)).toEqual(['Omega', 'Final']);
  } finally {
    stop();
    await close(runtime);
    await close(other);
  }
});

test('a nested refusal carrying another token is not this op’s refusal', async () => {
  const runtime = mount();
  const report = vi.spyOn(Telemetry, 'error');
  const { span } = recordedSpan();
  let queued: Promise<unknown> | undefined;
  const stop = runtime.view.onCommit(() => {
    if (queued !== undefined || paragraphs(runtime)[0] !== 'Omega') return;
    // Runs in op 1's drain, emitting a refusal for token 999.
    queued = dispatchApplicationCommandSettledIfSessionEdit(
      runtime.view,
      'group-c.ai-op',
      () => ({
        op: { kind: 'setText', node: 'missing1', text: 'x' },
        invocation: 999,
      })
    );
  });
  try {
    applyAiOpsNative(
      originOf(runtime.view),
      [setText('alphaId1', 'Omega'), setText('secondId', 'Final')],
      span
    );
    expect(paragraphs(runtime)).toEqual(['Omega', 'Final']);
    expect(report).not.toHaveBeenCalled();
    await queued;
  } finally {
    stop();
    await close(runtime);
  }
});

test('two AI edits group for undo by the 400 ms window, like Source', async () => {
  // Source rows: undo-gap.json ee25472b and loro-interval.json 981542e3.
  const rows: { gap: number; merged: boolean }[] = [];
  for (const gap of [0, 399, 400, 500]) {
    // Both host clocks move together, as in a browser: native MergeTracker
    // reads the executor's mono time, Loro's merge interval its wall time.
    let time = 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    const runtime = mount();
    const { span } = recordedSpan();
    try {
      const before = paragraphs(runtime);
      time += 1_000;
      applyAiOpsNative(
        originOf(runtime.view),
        [setText('alphaId1', 'Omega')],
        span
      );
      const afterFirst = paragraphs(runtime);
      time += gap;
      applyAiOpsNative(
        originOf(runtime.view),
        [setText('secondId', 'Final')],
        span
      );
      time += 10_000;
      undo(runtime);
      const undone = paragraphs(runtime);
      if (JSON.stringify(undone) === JSON.stringify(before))
        rows.push({ gap, merged: true });
      else {
        expect(undone).toEqual(afterFirst);
        rows.push({ gap, merged: false });
      }
    } finally {
      await close(runtime);
      vi.restoreAllMocks();
    }
  }
  expect(rows).toEqual([
    { gap: 0, merged: true },
    { gap: 399, merged: true },
    { gap: 400, merged: false },
    { gap: 500, merged: false },
  ]);
});
