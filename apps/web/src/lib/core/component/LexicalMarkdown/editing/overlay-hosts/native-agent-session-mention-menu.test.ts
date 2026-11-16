/** @vitest-environment jsdom */

import 'fake-indexeddb/auto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import type { EntityItem } from '@core/context/quickAccess';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { registerRichText } from '@lexical/rich-text';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import { AgentSessionMentionNode } from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { INITIALIZE_DOCUMENT_IDS } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import type { Point } from '@macro-inc/lexical-wasm-view/view/types';
import { NOOP_SPAN } from '@macro-inc/observability';
import {
  $createRangeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalEditor,
} from 'lexical';
import { createRoot, type ParentProps } from 'solid-js';
import { afterAll, beforeAll, expect, onTestFailed, test, vi } from 'vitest';
import { createItemHandler } from '../../component/menu/MentionsMenu/utils/mentionHandlers';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import { createNativeAgentSessionMentionContext } from '../../decorator-host/native-agent-session-mention-host';
import { createNativeAgentSessionMentionViews } from '../../decorator-host/native-agent-session-mention-views';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import {
  mentionsPlugin,
  REMOVE_INLINE_SEARCH_COMMAND,
  TYPE_AT_SYMBOL_COMMAND,
} from '../../plugins/mentions/mentionsPlugin';
import { theme } from '../../theme';
import type { AgentSessionMentionItem } from '../../utils/mentionsUtils';
import { createNativeUserMentionMenuHost } from './native-user-mention-menu';
import {
  compareRoots,
  createIdPairing,
  serializedJSON,
} from './source-native-model';
import { type CaseLifetime, caseLifetime } from './test-case-lifetime';

// Every Source-comparable row is paired: Source with its app wrapper and real
// node ids (as qualified for Query, native-query-callback.test.ts), the real
// mentions plugin and the menu's item handler, then native with the applied
// host, on the same imported input. Models are compared through compareRoots
// with one id pairing across phases; selections, outcomes and tracking calls
// are compared too. The bare-editor Source control (run-03/04) is qualified
// only for its own configuration and is not this oracle. Rows ruled native
// differences keep native-only expectations.

/** One input string for both engines: the Source control's base nodes. */
const INPUT_STATE = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: 'Hello  world',
            type: 'text',
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
      },
    ],
    direction: null,
    format: '',
    indent: 0,
  },
});

const { trackMention, quickAccessItems } = vi.hoisted(() => ({
  trackMention: vi.fn(),
  quickAccessItems: { agentSessions: [] as EntityItem[] },
}));
vi.mock('@core/signal/mention', () => ({ trackMention }));

// The same data-source and presentation-only providers as the Source control.
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    usesRecordSelection: () => false,
    usesSearchProjection: () => false,
    useList: (options?: { buckets?: string[] }) => ({
      items: () =>
        options?.buckets?.includes('agent_session')
          ? quickAccessItems.agentSessions
          : [],
      totalCount: () => 0,
      hasMore: () => false,
      isLoading: () => false,
      isLoadingMore: () => false,
      loadMore: async () => {},
    }),
  }),
}));
vi.mock('@app/features/crm/record-adapter', () => ({
  useCrmContactMentionSource: () => ({
    entities: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  }),
}));
vi.mock('@app/features/routines/routine-mentions', () => ({
  useRoutineMentionSource: () => () => [],
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/signal/splitLayout', () => ({ globalSplitManager: () => null }));
vi.mock(import('@core/block'), async (importOriginal) => ({
  ...(await importOriginal()),
  useMaybeBlockId: () => undefined,
  useMaybeBlockName: () => undefined,
}));
vi.mock('@app/features/external-chat/queries/production-api', () => ({
  externalChatApi: {},
}));
vi.mock('@queries/gate', () => ({
  queryReadyGate: (query: { isSuccess: boolean }) => query.isSuccess,
}));
vi.mock('@queries/external-chats', () => ({
  useExternalChatsQuery: () => ({ isSuccess: false, data: [] }),
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'owner@example.com',
  useUserId: () => () => 'owner',
}));
vi.mock('@core/util/dateSearch/useDateSearch', () => ({
  useDateSearch: () => () => [],
}));
vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: ParentProps) => props.children,
}));
vi.mock('../../directive/floatWithSelection', () => ({
  floatWithSelection: vi.fn(),
}));
vi.mock('../../directive/floatWithElement', () => ({
  floatWithElement: vi.fn(),
}));
vi.mock(
  '../../component/menu/MentionsMenu/hooks/useEmailSearchMention',
  () => ({
    useEmailSearchMention: () => ({
      emails: () => [],
      isLoading: () => false,
      error: () => undefined,
      totalCount: () => 0,
      hasMore: () => false,
      isLoadingMore: () => false,
      loadMore: async () => {},
    }),
  })
);
vi.mock(
  '../../component/menu/MentionsMenu/hooks/useBookingLinkMention',
  () => ({
    useBookingLinkMention: () => ({
      bookingLinks: () => [],
      isLoading: () => false,
    }),
  })
);
vi.mock(
  '../../component/menu/MentionsMenu/hooks/useCalendarEventMention',
  () => ({ useCalendarEventMention: () => ({ events: () => [] }) })
);
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

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
        '../../../../document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

const SESSION: AgentSessionMentionItem = {
  kind: 'agentSession',
  bucket: 'agent_session',
  sortTimestamp: 0,
  id: 'session',
  searchText: 'Ada Fix mentions',
  timestamps: { createdAt: new Date(0), updatedAt: new Date(0) },
  data: {
    type: 'agent_session',
    id: 'session',
    name: 'Fix mentions',
    ownerId: 'owner',
    botId: 'bot',
    bot: { id: 'bot', name: 'Ada' },
    status: 'no_messages',
    createdAt: '',
    updatedAt: '',
  },
};

/** A real native session on INPUT_STATE, caret at 6, with a live mention search. */
function mount(
  source: Caller,
  // Every release waits for the case's pending selects (see selectPending).
  lifetime: CaseLifetime = caseLifetime(
    expect.getState().currentTestName ?? 'case'
  )
) {
  setDecorator(AgentSessionMentionNode, () => null);
  lifetime.release(clearDecorators);
  const root = document.createElement('div');
  document.body.append(root);
  lifetime.release(() => root.remove());
  const context = createNativeAgentSessionMentionContext(theme, () => true);
  lifetime.release(() => context.dispose());
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroDecoratorViews(
      registerMacroElementViews(createBuiltinRegistry()),
      createNativeAgentSessionMentionViews(context)
    ),
    {
      namespace: 'agent-session-menu',
      theme: {},
      editable: true,
      preset: 'rich',
      parentSpan: NOOP_SPAN,
      onError: (error) => errors.push(error),
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
          'agent-session-menu'
        ),
    }
  );
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await runtime.close();
  };
  lifetime.release(close);
  runtime.port.setState(INPUT_STATE);
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!text) throw new Error('Missing actual native text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 6, type: 'text' },
    focus: { key: text.key, offset: 6, type: 'text' },
  });
  // Import and caret, before the search: the first paired phase.
  const before = nativeModel(runtime);
  dispatchApplicationCommand(runtime.view, 'group-a.search-trigger', {
    kind: 'mentions',
  });
  runtime.port.command(CommandCode.InsertText, 0, 0, 'fix');
  expect(
    [...runtime.view.mirror.values()].some(
      (node) => node.type === 'inline-search'
    )
  ).toBe(true);
  const admissions: unknown[] = [];
  const admit = runtime.port.inputSettledIfSessionEdit;
  if (!admit) throw new Error('Missing settled session edit admission');
  const realAdmit = admit.bind(runtime.port);
  const admitSpy = vi
    .spyOn(runtime.port, 'inputSettledIfSessionEdit')
    .mockImplementation(async (...args: Parameters<typeof realAdmit>) => {
      const result = await realAdmit(...args);
      admissions.push(result);
      return result;
    });
  lifetime.release(() => admitSpy.mockRestore());
  const host = createNativeUserMentionMenuHost(
    runtime.view,
    {
      // The native host takes a string; an absent source document is '',
      // falsy for tracksMentions exactly as undefined is for Source.
      sourceDocumentId: source.sourceDocumentId ?? '',
      blockName: source.blockName,
      disableMentionTracking: source.disableMentionTracking ?? false,
    },
    () => !closed
  );
  return {
    ...runtime,
    lifetime,
    before,
    errors,
    admissions,
    host,
    close,
    revokeEdit() {
      runtime.executor.run(() =>
        runtime.executor.session.authorization(
          true,
          false,
          false,
          runtime.executor.now(),
          Date.now()
        )
      );
    },
  };
}

type Mounted = ReturnType<typeof mount>;

/** The paragraph's children as [type, text-or-mention props]. */
function paragraph(mounted: Mounted) {
  const rootNode = mounted.view.mirror.node(0);
  const first = rootNode && mounted.view.mirror.node(rootNode.children[0]);
  if (!first) throw new Error('Missing actual native paragraph');
  return first.children.map((key) => {
    const node = mounted.view.mirror.node(key);
    if (!node) throw new Error('Missing actual native child');
    if (node.type === 'agent-session-mention') return [node.type, node.props()];
    return [node.type, node.text];
  });
}

/**
 * Starts the actual select with tracking held open. Tracking settles once; the
 * case's lifetime settles it if the body did not and joins the actual select
 * before any release. A select that does not settle retains every resource
 * and stops the job (test-case-lifetime.ts).
 */
function selectPending(mounted: Mounted, item: AgentSessionMentionItem) {
  const tracking = Promise.withResolvers<string | undefined>();
  const entered = Promise.withResolvers<void>();
  let settled = false;
  const settleOnce = () => {
    if (settled) throw new Error('Tracking settled twice');
    settled = true;
  };
  const gate = {
    resolve(value: string | undefined) {
      settleOnce();
      tracking.resolve(value);
    },
    reject(error: unknown) {
      settleOnce();
      tracking.reject(error);
    },
  };
  trackMention.mockReset();
  trackMention.mockImplementation(() => {
    entered.resolve();
    return tracking.promise;
  });
  let failed = false;
  onTestFailed(() => {
    failed = true;
  });
  const selecting = Promise.resolve(mounted.host.select(item));
  // Observed at once, so a rejection is never unhandled; the body asserts it.
  const outcome = selecting.then(
    () => ({ status: 'fulfilled' as const }),
    (reason: unknown) => ({ status: 'rejected' as const, reason })
  );
  mounted.lifetime.join(async () => {
    if (!settled) gate.resolve(undefined);
    const joined = await outcome;
    // The body's failure stays primary; the select's raw outcome is secondary.
    if (failed && joined.status === 'rejected')
      throw new Error('select also rejected', { cause: joined.reason });
  });
  return { gate, entered: entered.promise, selecting };
}

const TRACKED = { sourceDocumentId: 'doc-1', blockName: 'md' } as const;
/** A replacement document in the same full-field form as the input. */
const REPLACEMENT = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: 'replacement',
            type: 'text',
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
      },
    ],
    direction: null,
    format: '',
    indent: 0,
  },
});

type Caller = {
  sourceDocumentId?: string;
  blockName?: 'md' | 'channel' | 'chat';
  disableMentionTracking?: boolean;
};
/** A change made while tracking is pending, on the actual post-removal nodes. */
type Pending =
  | 'none'
  | 'expanded-forward'
  | 'expanded-backward'
  | 'element'
  | 'null'
  | 'text'
  | 'replace-state';
type Settle = { value: string | undefined } | { reject: true };
type Outcome =
  | { status: 'fulfilled' }
  | { status: 'rejected'; reason: unknown };

/** Holds tracking open; settles exactly once, by the row or on exit. */
function trackingGate() {
  const held = Promise.withResolvers<string | undefined>();
  const entered = Promise.withResolvers<'entered'>();
  // This gate's own rejection: a reject row must see exactly this object.
  const failure = new Error('track failed');
  let settled = false;
  trackMention.mockReset();
  trackMention.mockImplementation(() => {
    entered.resolve('entered');
    return held.promise;
  });
  return {
    entered: entered.promise,
    failure,
    settle(settle: Settle) {
      if (settled) throw new Error('Tracking settled twice');
      settled = true;
      if ('reject' in settle) held.reject(failure);
      else held.resolve(settle.value);
    },
    release() {
      if (settled) return;
      settled = true;
      held.resolve(undefined);
    },
  };
}

/** The actual outcome, keeping the raw rejection reason. */
function observe(running: Promise<unknown>): Promise<Outcome> {
  return running.then(
    (): Outcome => ({ status: 'fulfilled' }),
    (reason: unknown): Outcome => ({ status: 'rejected', reason })
  );
}

/** Cross-engine comparison: status and message only. */
function comparable(outcome: Outcome) {
  return outcome.status === 'fulfilled'
    ? outcome
    : { status: outcome.status, message: rejectionMessage(outcome.reason) };
}

function rejectionMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Raw observations of one paired row, each written at once to its own file
 * before any later step can fail; wx never overwrites.
 */
function rowSink(name: string) {
  const output = process.env.AGENT_SESSION_MENU_OUT;
  const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return (engine: 'source' | 'native', phase: string, data: object) => {
    if (!output) return;
    writeFileSync(
      `${output}/${slug}--${engine}--${phase}.json`,
      `${JSON.stringify({ row: name, engine, phase, ...data }, null, 1)}\n`,
      { flag: 'wx' }
    );
  };
}

function rawOutcome(outcome: Outcome, failure: Error) {
  return outcome.status === 'fulfilled'
    ? outcome
    : {
        status: outcome.status,
        name: outcome.reason instanceof Error ? outcome.reason.name : undefined,
        message: rejectionMessage(outcome.reason),
        isOwnTrackingFailure: outcome.reason === failure,
      };
}

/** Source with its app wrapper and real ids on the exact input, caret at 6. */
function sourceEditor(lifetime: CaseLifetime): LexicalEditor {
  const wrapper = createRoot((dispose) => {
    lifetime.release(dispose);
    const created = createLexicalWrapper({
      type: 'markdown-sync',
      namespace: 'block-md-main',
      isInteractable: () => true,
      withIds: true,
    });
    lifetime.release(() => created.cleanup());
    return created;
  });
  const editor = wrapper.editor;
  const root = document.createElement('div');
  lifetime.release(() => root.remove());
  root.contentEditable = 'true';
  document.body.append(root);
  editor.setRootElement(root);
  lifetime.release(() => editor.setRootElement(null));
  lifetime.release(registerRichText(editor));
  const unregister = mentionsPlugin({ sourceDocumentId: 'doc-1' })(editor);
  if (unregister) lifetime.release(unregister);
  editor.setEditorState(editor.parseEditorState(INPUT_STATE));
  expect(editor.dispatchCommand(INITIALIZE_DOCUMENT_IDS, undefined)).toBe(true);
  editor.update(
    () => {
      const text = $getRoot().getFirstDescendant();
      if (!$isTextNode(text)) throw new Error('Source imported text missing');
      text.select(6, 6);
    },
    { discrete: true }
  );
  return editor;
}

function applySource(editor: LexicalEditor, pending: Pending) {
  if (pending === 'none') return;
  if (pending === 'replace-state') {
    editor.setEditorState(editor.parseEditorState(REPLACEMENT));
    return;
  }
  editor.update(
    () => {
      const paragraph = $getRoot().getFirstChild();
      if (!$isElementNode(paragraph))
        throw new Error('Source paragraph missing');
      const texts = paragraph.getChildren().filter($isTextNode);
      if (pending === 'null') return $setSelection(null);
      if (pending === 'text') return $getSelection()?.insertText('X');
      const selection = $createRangeSelection();
      if (pending === 'element') {
        selection.anchor.set(paragraph.getKey(), 1, 'element');
        selection.focus.set(paragraph.getKey(), 1, 'element');
      } else if (pending === 'expanded-forward') {
        const last = texts.at(-1);
        if (!last) throw new Error('Source text missing');
        selection.anchor.set(last.getKey(), 1, 'text');
        selection.focus.set(last.getKey(), 6, 'text');
      } else {
        const first = texts[0];
        if (!first) throw new Error('Source text missing');
        selection.anchor.set(first.getKey(), 5, 'text');
        selection.focus.set(first.getKey(), 0, 'text');
      }
      $setSelection(selection);
    },
    { discrete: true }
  );
}

function applyNative(mounted: Mounted, pending: Pending) {
  if (pending === 'none') return;
  if (pending === 'replace-state') {
    const generation = mounted.view.mirror.keyGeneration;
    mounted.port.setState(REPLACEMENT);
    // Same-view replacement keeps the key generation.
    expect(mounted.view.mirror.keyGeneration).toBe(generation);
    return;
  }
  if (pending === 'null') {
    mounted.port.selectionFromView({ kind: 'none' });
    return;
  }
  if (pending === 'text') {
    mounted.port.command(CommandCode.InsertText, 0, 0, 'X');
    return;
  }
  const paragraphKey = mounted.view.mirror.node(0)?.children[0];
  const paragraph =
    paragraphKey === undefined
      ? undefined
      : mounted.view.mirror.node(paragraphKey);
  if (!paragraph) throw new Error('Native paragraph missing');
  const texts = paragraph.children.filter(
    (key) => mounted.view.mirror.node(key)?.kind === 'text'
  );
  if (pending === 'element') {
    mounted.port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, offset: 1, type: 'element' },
      focus: { key: paragraph.key, offset: 1, type: 'element' },
    });
    return;
  }
  const [anchor, focus, key] =
    pending === 'expanded-forward' ? [1, 6, texts.at(-1)] : [5, 0, texts[0]];
  if (key === undefined) throw new Error('Native text missing');
  mounted.port.selectionFromView({
    kind: 'range',
    anchor: { key, offset: anchor, type: 'text' },
    focus: { key, offset: focus, type: 'text' },
  });
}

type Row = {
  name: string;
  caller: Caller;
  item?: AgentSessionMentionItem;
  tracked: boolean;
  pending?: Pending;
  settle?: Settle;
};

/** Source first, to completion, then native; both through the same row. */
async function pairedRow(row: Row) {
  const lifetime = caseLifetime(row.name);
  const record = rowSink(row.name);
  const item = row.item ?? SESSION;
  const pending = row.pending ?? 'none';
  const settle = row.settle ?? { value: 'mention-uuid' };

  const editor = sourceEditor(lifetime);
  const source: Record<string, Model> = { before: sourceModel(editor) };
  record('source', 'before', source.before);
  expect(editor.dispatchCommand(TYPE_AT_SYMBOL_COMMAND, undefined)).toBe(true);
  editor.update(() => $getSelection()?.insertText('fix'), { discrete: true });
  let sourceRemoved = false;
  lifetime.release(
    editor.registerCommand(
      REMOVE_INLINE_SEARCH_COMMAND,
      () => {
        sourceRemoved = true;
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    )
  );
  const sourceTracking = trackingGate();
  const sourceOutcome = observe(
    createItemHandler({
      editor,
      blockId: row.caller.sourceDocumentId,
      blockName: row.caller.blockName,
      disableMentionTracking: row.caller.disableMentionTracking,
    })(item)
  );
  lifetime.join(async () => {
    sourceTracking.release();
    await sourceOutcome;
  });
  if (row.tracked) {
    const sourceGate = await Promise.race([
      sourceTracking.entered,
      sourceOutcome,
    ]);
    // A failed setup gate is recorded, with the raw outcome, before it throws.
    if (sourceGate !== 'entered' || !sourceRemoved)
      record('source', 'gate-failed', {
        removed: sourceRemoved,
        outcome:
          sourceGate === 'entered'
            ? sourceGate
            : rawOutcome(sourceGate, sourceTracking.failure),
      });
    expect(sourceGate).toBe('entered');
    expect(sourceRemoved).toBe(true);
    editor.read(() => {});
    source.afterRemove = sourceModel(editor);
    record('source', 'afterRemove', source.afterRemove);
    applySource(editor, pending);
    sourceTracking.settle(settle);
  }
  const sourceResult = await sourceOutcome;
  editor.read(() => {});
  source.after = sourceModel(editor);
  const sourceCalls = trackMention.mock.calls.map((call) => [...call]);
  record('source', 'after', {
    ...source.after,
    outcome: rawOutcome(sourceResult, sourceTracking.failure),
    calls: sourceCalls,
  });

  const mounted = mount(row.caller, lifetime);
  const native: Record<string, Model> = { before: mounted.before };
  record('native', 'before', native.before);
  const nativeTracking = trackingGate();
  const nativeOutcome = observe(Promise.resolve(mounted.host.select(item)));
  lifetime.join(async () => {
    nativeTracking.release();
    await nativeOutcome;
  });
  if (row.tracked) {
    const nativeGate = await Promise.race([
      nativeTracking.entered,
      nativeOutcome,
    ]);
    if (
      nativeGate !== 'entered' ||
      (mounted.admissions[0] as { status?: string } | undefined)?.status !==
        'success'
    )
      record('native', 'gate-failed', {
        admissions: mounted.admissions,
        outcome:
          nativeGate === 'entered'
            ? nativeGate
            : rawOutcome(nativeGate, nativeTracking.failure),
      });
    expect(nativeGate).toBe('entered');
    expect(mounted.admissions[0]).toMatchObject({ status: 'success' });
    native.afterRemove = nativeModel(mounted);
    record('native', 'afterRemove', native.afterRemove);
    applyNative(mounted, pending);
    nativeTracking.settle(settle);
  }
  const nativeResult = await nativeOutcome;
  native.after = nativeModel(mounted);
  const nativeCalls = trackMention.mock.calls.map((call) => [...call]);
  record('native', 'after', {
    ...native.after,
    outcome: rawOutcome(nativeResult, nativeTracking.failure),
    calls: nativeCalls,
    errors: mounted.errors.map(String),
  });

  const ids = createIdPairing();
  for (const phase of ['before', 'afterRemove', 'after'] as const) {
    const sourcePhase = source[phase];
    const nativePhase = native[phase];
    if (!sourcePhase && !nativePhase) continue;
    if (!sourcePhase || !nativePhase)
      throw new Error(`${phase} recorded on one side only`);
    compareRoots(
      sourcePhase.json.root,
      nativePhase.json.root,
      {
        // Source's root id from import, dropped by a same-view replacement (as
        // observed in green-02); native's root has none yet
        // (C-ROOT-ID-PRESENCE-01, open, fix pending), so root ids are not
        // paired. When that fix lands, the native contract carries the id.
        source:
          phase === 'after' && pending === 'replace-state' ? 'absent' : 'id',
        // Native's current root metadata, a ruled named difference from Source
        // (C-R003-PERSISTED-ROOT-METADATA-01); not parity.
        native: { documentMetadata: { version: 11 } },
      },
      ids,
      phase
    );
    expect(nativePhase.selection, `${phase} selection`).toEqual(
      sourcePhase.selection
    );
  }
  if ('reject' in settle) {
    // Each engine rejects with its own gate's tracking error, not a copy.
    expect(sourceResult).toEqual({
      status: 'rejected',
      reason: sourceTracking.failure,
    });
    expect(sourceResult.status === 'rejected' && sourceResult.reason).toBe(
      sourceTracking.failure
    );
    expect(nativeResult.status === 'rejected' && nativeResult.reason).toBe(
      nativeTracking.failure
    );
  }
  expect(comparable(nativeResult)).toEqual(comparable(sourceResult));
  expect(nativeCalls).toEqual(sourceCalls);
  expect(mounted.errors).toEqual([]);
  return { source, native, sourceResult };
}

const PAIRED: Row[] = [
  { name: 'row: tracked, caret unchanged', caller: TRACKED, tracked: true },
  {
    name: 'row: tracked, expanded forward while pending',
    caller: TRACKED,
    tracked: true,
    pending: 'expanded-forward',
  },
  {
    name: 'row: tracked, expanded backward while pending',
    caller: TRACKED,
    tracked: true,
    pending: 'expanded-backward',
  },
  {
    name: 'row: tracked, element caret while pending',
    caller: TRACKED,
    tracked: true,
    pending: 'element',
  },
  {
    name: 'row: tracked, null selection while pending',
    caller: TRACKED,
    tracked: true,
    pending: 'null',
  },
  {
    name: 'row: tracked, text typed while pending',
    caller: TRACKED,
    tracked: true,
    pending: 'text',
  },
  // Same-view state replacement keeps the key generation (asserted in
  // applyNative); not evidence about a different document or view.
  {
    name: 'row: tracked, state replaced while pending',
    caller: TRACKED,
    tracked: true,
    pending: 'replace-state',
  },
  {
    name: 'row: tracked, empty mention id is left out',
    caller: TRACKED,
    tracked: true,
    settle: { value: '' },
  },
  {
    name: 'row: tracked, undefined mention id is left out',
    caller: TRACKED,
    tracked: true,
    settle: { value: undefined },
  },
  {
    name: 'row: tracked, tracking rejects',
    caller: TRACKED,
    tracked: true,
    settle: { reject: true },
  },
  {
    name: 'row: tracked, empty label',
    caller: TRACKED,
    item: { ...SESSION, data: { ...SESSION.data, name: '' } },
    tracked: true,
  },
  {
    name: 'row: tracking disabled inserts without tracking',
    caller: { ...TRACKED, disableMentionTracking: true },
    tracked: false,
  },
  {
    name: 'row: no source document inserts without tracking',
    caller: { blockName: 'md' },
    tracked: false,
  },
  {
    name: 'row: channel caller inserts without tracking',
    caller: { sourceDocumentId: 'doc-1', blockName: 'channel' },
    tracked: false,
  },
  {
    name: 'row: chat caller inserts without tracking',
    caller: { sourceDocumentId: 'doc-1', blockName: 'chat' },
    tracked: false,
  },
];

for (const row of PAIRED)
  test(row.name, async () => {
    await pairedRow(row);
  });

// C-AGENT-MENTION-READONLY-INSERT-01 (ruled named difference): Source inserted
// after editability was removed (run-03 'menu: tracked, read-only while
// pending'); native refuses through its existing session edit admission.
test('row: edit access revoked while pending is refused (C-AGENT-MENTION-READONLY-INSERT-01)', async () => {
  const mounted = mount(TRACKED);
  const { gate, entered, selecting } = selectPending(mounted, SESSION);
  await Promise.race([entered, selecting]);
  expect(trackMention).toHaveBeenCalledExactlyOnceWith(
    'doc-1',
    'agent_session',
    'session'
  );
  const atPending = paragraph(mounted);
  mounted.revokeEdit();
  const before = mounted.admissions.length;
  gate.resolve('mention-uuid');
  await selecting;
  // The refusal is the existing session admission's own result.
  expect(mounted.admissions.slice(before)).toEqual([
    { status: 'cancelled', reason: 'session-access' },
  ]);
  expect(paragraph(mounted)).toEqual(atPending);
  expect(mounted.errors).toEqual([]);
});

// C-NATIVE-GENERATION-RETIRE-NO-RETARGET-01 guard-branch diagnostic: no fixture
// or port path retires the key generation inside one live view, so ONE
// observation is injected (view.mirror.keyGeneration reads generation + 1
// while tracking is pending); the session, admission and commands stay real.
// This exercises the host's generation guard only; it is not runtime
// generation retirement or document-rebind evidence.
test('row: injected key generation change while pending inserts nothing (C-NATIVE-GENERATION-RETIRE-NO-RETARGET-01)', async () => {
  const mounted = mount(TRACKED);
  const { gate, entered, selecting } = selectPending(mounted, SESSION);
  await Promise.race([entered, selecting]);
  const generation = mounted.view.mirror.keyGeneration;
  if (generation === null) throw new Error('Missing actual view generation');
  const before = mounted.admissions.length;
  const atEntry = paragraph(mounted);
  // INJECTED: the only non-real observation in this row.
  const injection = vi
    .spyOn(mounted.view.mirror, 'keyGeneration', 'get')
    .mockReturnValue(generation + 1);
  mounted.lifetime.release(() => injection.mockRestore());
  gate.resolve('mention-uuid');
  await expect(selecting).resolves.toBeUndefined();
  expect(mounted.admissions.length).toBe(before);
  expect(paragraph(mounted)).toEqual(atEntry);
  expect(mounted.errors).toEqual([]);
});

// C-AGENT-MENTION-READONLY-INSERT-01: Source inserted into a fixture-unbound
// editor (run-03 'menu: tracked, root detached while pending', fixture only);
// a closed native session has nothing to insert into.
test('row: session closed while pending inserts nothing (C-AGENT-MENTION-READONLY-INSERT-01)', async () => {
  const mounted = mount(TRACKED);
  const { gate, entered, selecting } = selectPending(mounted, SESSION);
  await Promise.race([entered, selecting]);
  expect(trackMention).toHaveBeenCalledExactlyOnceWith(
    'doc-1',
    'agent_session',
    'session'
  );
  await mounted.close();
  const before = mounted.admissions.length;
  gate.resolve('mention-uuid');
  await expect(selecting).resolves.toBeUndefined();
  expect(mounted.view.isMounted).toBe(false);
  // Nothing is offered for admission once the session has closed.
  expect(mounted.admissions.length).toBe(before);
  expect(mounted.errors).toEqual([]);
});

type Model = {
  json: { root: Record<string, unknown> & { children: unknown } };
  selection: unknown;
};
function nativeModel(runtime: ReturnType<typeof mountLocalSessionView>): Model {
  const { selection, format, style } = runtime.view.selection();
  const point = (value: Point) => {
    let node = runtime.view.node(value.key);
    if (!node) throw new Error('Native point missing');
    const path: number[] = [];
    while (node.parent !== null) {
      const parent = runtime.view.node(node.parent);
      if (!parent) throw new Error('Native parent missing');
      path.unshift(parent.children.indexOf(node.key));
      node = parent;
    }
    return { path, offset: value.offset, type: value.type };
  };
  return {
    json: JSON.parse(runtime.executor.session.serializedState()),
    selection:
      selection.kind === 'range'
        ? {
            kind: 'range',
            anchor: point(selection.anchor),
            focus: point(selection.focus),
            format,
            style,
          }
        : { kind: selection.kind },
  };
}

function sourceModel(editor: LexicalEditor): Model {
  return {
    // Source's SERIALIZED form, like for like with native's parsed string: the
    // live toJSON can hold own undefined keys (AgentSessionMentionNode.ts:130-140
    // writes mentionUuid as-is) that no persisted or sent JSON carries.
    json: serializedJSON(editor.getEditorState().toJSON()) as Model['json'],
    selection: editor.getEditorState().read(() => {
      const selected = $getSelection();
      if (selected === null) return { kind: 'none' };
      if (!$isRangeSelection(selected))
        throw new Error('Unexpected Source selection');
      const point = (key: string, offset: number, type: 'text' | 'element') => {
        let node = $getNodeByKey(key);
        if (!node) throw new Error('Source point missing');
        const path: number[] = [];
        for (let parent = node.getParent(); parent; parent = node.getParent()) {
          path.unshift(node.getIndexWithinParent());
          node = parent;
        }
        return { path, offset, type };
      };
      return {
        kind: 'range',
        anchor: point(
          selected.anchor.key,
          selected.anchor.offset,
          selected.anchor.type
        ),
        focus: point(
          selected.focus.key,
          selected.focus.offset,
          selected.focus.type
        ),
        format: selected.format,
        style: selected.style,
      };
    }),
  };
}
