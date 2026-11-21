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
import { fireEvent, render, within } from '@solidjs/testing-library';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
} from 'lexical';
import { createRoot, type ParentProps } from 'solid-js';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { MentionsMenu } from '../../component/menu/MentionsMenu/MentionsMenu';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import { createNativeAgentSessionMentionContext } from '../../decorator-host/native-agent-session-mention-host';
import { createNativeAgentSessionMentionViews } from '../../decorator-host/native-agent-session-mention-views';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import {
  mentionsPlugin,
  TYPE_AT_SYMBOL_COMMAND,
} from '../../plugins/mentions/mentionsPlugin';
import { createMenuOperations } from '../../shared/inlineMenu';
import { theme } from '../../theme';
import type { AgentSessionMentionItem } from '../../utils/mentionsUtils';
import { NativeUserMentionsOverlay } from '../NativeUserMentionsOverlay';
import {
  compareRoots,
  createIdPairing,
  serializedJSON,
} from './source-native-model';
import { type CaseLifetime, caseLifetime } from './test-case-lifetime';

// Exposure of the agentSessions mention source in the native overlay. Source
// is its real document MentionsMenu with no sources override (as
// MarkdownEditingOverlays mounts it) on the app wrapper with real ids; native
// is the real NativeUserMentionsOverlay with its production source config
// (RustMarkdownEditor). Both read the same declared providers. Sections are
// compared as rendered headings; the insert is compared as serialized models
// with persistent node-id pairing, selections, outcomes and tracking calls.

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

const {
  trackMention,
  quickAccessItems,
  quickAccessCalls,
  quickAccessCreations,
  provider,
  hosts,
  candidates,
} = vi.hoisted(() => ({
  trackMention: vi.fn(),
  quickAccessItems: {
    person: [] as unknown[],
    documents: [] as unknown[],
    agentSessions: [] as unknown[],
  },
  quickAccessCalls: [] as {
    buckets?: string[];
    list?: string;
    enabled?: boolean;
  }[],
  quickAccessCreations: [] as { buckets?: string[]; list?: string }[],
  provider: { mobile: false },
  // Mobile candidate data as the real Hosted controller hands it to
  // VirtualizedItemList; the engine is set by the case before each render.
  candidates: {
    engine: undefined as 'source' | 'native' | undefined,
    seen: { source: [] as unknown[][], native: [] as unknown[][] },
    notify: () => {},
  },
  hosts: {
    selects: [] as {
      engine: 'source' | 'native';
      outcome: Promise<
        { status: 'fulfilled' } | { status: 'rejected'; reason: unknown }
      >;
    }[],
  },
}));
vi.mock('@core/signal/mention', () => ({ trackMention }));

// One declared quick-access provider feeds the real users, documents and
// agent-session hooks of both menus. A list honours its `enabled` accessor;
// every list creation and every read is recorded, so the session gate is
// observed, not bypassed.
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    usesRecordSelection: () => false,
    usesSearchProjection: () => false,
    isLoading: () => false,
    useList: (
      options?:
        | string
        | { buckets?: string[]; enabled?: () => boolean | undefined }
    ) => {
      const list = typeof options === 'string' ? options : undefined;
      const buckets = typeof options === 'object' ? options.buckets : undefined;
      const enabled =
        typeof options === 'object' && options.enabled
          ? () => options.enabled?.() !== false
          : () => true;
      // A list exists only where the menu creates one; record each creation.
      quickAccessCreations.push({ list, buckets });
      return {
        items: () => {
          const on = enabled();
          quickAccessCalls.push({ list, buckets, enabled: on });
          if (!on) return [];
          // Main's useUsersMention asks for the person bucket.
          if (list === 'person' || buckets?.includes('person'))
            return quickAccessItems.person;
          if (buckets?.includes('agent_session'))
            return quickAccessItems.agentSessions;
          if (buckets?.includes('document')) return quickAccessItems.documents;
          return [];
        },
        totalCount: () => 0,
        hasMore: () => false,
        isLoading: () => false,
        isLoadingMore: () => false,
        loadMore: async () => {},
        error: () => undefined,
      };
    },
  }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => provider.mobile }));

// MOBILE CANDIDATE DATA ONLY: a call-through around the real
// VirtualizedItemList that records the items the real Hosted controller passes
// it, and returns the real component's output unchanged. It never adds,
// filters, clicks or replaces anything. Virtualized DOM rows, the mobile click
// and browser behaviour are NOT qualified here (deferred to browser acceptance).
vi.mock(
  import('../../component/menu/MentionsMenu/components/VirtualizedItemList'),
  async (importOriginal) => {
    const actual = await importOriginal();
    const { createEffect } = await import('solid-js');
    return {
      ...actual,
      VirtualizedItemList: (
        props: Parameters<typeof actual.VirtualizedItemList>[0]
      ) => {
        const engine = candidates.engine;
        createEffect(() => {
          const snapshot = props.items.map((item) => ({
            kind: item.kind,
            bucket: 'bucket' in item ? item.bucket : undefined,
            id: item.id,
          }));
          if (engine) {
            candidates.seen[engine].push(snapshot);
            candidates.notify();
          }
        });
        return actual.VirtualizedItemList(props);
      },
    };
  }
);

// Call-through wrappers keep each real host and record its actual select
// promise, so the case can join it; nothing else about either host changes.
vi.mock(import('./native-user-mention-menu'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createNativeUserMentionMenuHost: (
      ...args: Parameters<typeof actual.createNativeUserMentionMenuHost>
    ) => {
      const host = actual.createNativeUserMentionMenuHost(...args);
      return {
        ...host,
        select(item: Parameters<typeof host.select>[0]) {
          const selecting = Promise.resolve(host.select(item));
          hosts.selects.push({
            engine: 'native',
            outcome: selecting.then(
              () => ({ status: 'fulfilled' as const }),
              (reason: unknown) => ({ status: 'rejected' as const, reason })
            ),
          });
          return selecting;
        },
      };
    },
  };
});
vi.mock(import('./lexical-mentions'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createLexicalMentionMenuHost: (
      ...args: Parameters<typeof actual.createLexicalMentionMenuHost>
    ) => {
      const host = actual.createLexicalMentionMenuHost(...args);
      return {
        ...host,
        select(item: Parameters<typeof host.select>[0]) {
          const selecting = Promise.resolve(host.select(item));
          hosts.selects.push({
            engine: 'source',
            outcome: selecting.then(
              () => ({ status: 'fulfilled' as const }),
              (reason: unknown) => ({ status: 'rejected' as const, reason })
            ),
          });
          return selecting;
        },
      };
    },
  };
});

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
// The shared menu reads both contact feature flags. This fixture keeps both
// off and refuses flags outside those actual dependencies.
vi.mock('@app/lib/analytics/posthog', async (importOriginal) => {
  const { disableCrmContactSearch, enableContactLists } = await import(
    '@core/constant/featureFlags'
  );
  return {
    ...(await importOriginal<typeof import('@app/lib/analytics/posthog')>()),
    useFeatureFlag: (flag: unknown) => {
      if (flag !== disableCrmContactSearch && flag !== enableContactLists)
        throw new Error('Unexpected PostHog flag in this fixture');
      return () => ({ enabled: false, loading: false });
    },
  };
});
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

const USER = {
  id: 'user-ada',
  kind: 'user',
  bucket: 'person',
  sortTimestamp: 0,
  timestamps: { lastInteraction: 0 },
  searchText: 'Ada | ada@example.com',
  data: { id: 'user-ada', name: 'Ada', email: 'ada@example.com' },
};
const DOCUMENT: EntityItem = {
  kind: 'entity',
  bucket: 'document',
  sortTimestamp: 0,
  id: 'doc-2',
  searchText: 'Plan',
  timestamps: { createdAt: new Date(0), updatedAt: new Date(0) },
  data: {
    type: 'document',
    id: 'doc-2',
    name: 'Plan',
    ownerId: 'owner',
    createdAt: '',
    updatedAt: '',
  },
} as EntityItem;
quickAccessItems.person = [USER];
quickAccessItems.documents = [DOCUMENT];
quickAccessItems.agentSessions = [{ ...SESSION, kind: 'entity' }];

/** Tracking held open; settled once per hold, released on every exit. */
const tracking = (() => {
  let held = Promise.withResolvers<string | undefined>();
  let entered = Promise.withResolvers<void>();
  let settled = true;
  trackMention.mockImplementation(() => {
    entered.resolve();
    return held.promise;
  });
  return {
    hold() {
      held = Promise.withResolvers<string | undefined>();
      entered = Promise.withResolvers<void>();
      settled = false;
    },
    entered: () => entered.promise,
    settle(value: string | undefined) {
      if (settled) throw new Error('Tracking settled twice');
      settled = true;
      held.resolve(value);
    },
    release() {
      if (settled) return;
      settled = true;
      held.resolve(undefined);
    },
  };
})();

/** Each observation, written at once to its own file; wx never overwrites. */
let record: (engine: 'source' | 'native', phase: string, data: object) => void =
  () => {
    throw new Error('No case is recording');
  };

type Outcome =
  | { status: 'fulfilled' }
  | { status: 'rejected'; reason: unknown };

/** An outcome in a recordable form, keeping the raw rejection's name/message. */
function rawOutcome(outcome: Outcome) {
  if (outcome.status === 'fulfilled') return outcome;
  const { reason } = outcome;
  return {
    status: outcome.status,
    name: reason instanceof Error ? reason.name : undefined,
    message: reason instanceof Error ? reason.message : String(reason),
  };
}

/** What the quick-access provider saw since the last reset, then reset it. */
function takeProvider() {
  const snapshot = {
    created: quickAccessCreations.map((call) => ({ ...call })),
    reads: quickAccessCalls.map((call) => ({ ...call })),
  };
  quickAccessCreations.length = 0;
  quickAccessCalls.length = 0;
  return snapshot;
}

function touchesSessions(provider: ReturnType<typeof takeProvider>) {
  return {
    created: provider.created.some((call) =>
      call.buckets?.includes('agent_session')
    ),
    read: provider.reads.some((call) =>
      call.buckets?.includes('agent_session')
    ),
  };
}

/** Rendered section headings, in order (ItemBin: the header's first span). */
function sectionLabels(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll(
      'div.font-medium.p-2.pt-0 > span:first-child'
    ),
  ].map((element) => element.textContent?.trim() ?? '');
}

/** The same input and caret in Source's app wrapper with real node ids. */
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

/** Open the real '@' search in Source and type 'fix'. */
function openSourceSearch(editor: LexicalEditor) {
  expect(editor.dispatchCommand(TYPE_AT_SYMBOL_COMMAND, undefined)).toBe(true);
  editor.update(() => $getSelection()?.insertText('fix'), { discrete: true });
}

/** A live native session on the same input, caret at 6, '@fix' search open. */
function nativeSession(lifetime: CaseLifetime) {
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
      namespace: 'agent-session-exposure',
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
          'agent-session-exposure'
        ),
    }
  );
  let closed = false;
  lifetime.release(async () => {
    closed = true;
    await runtime.close();
  });
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
  const before = nativeModel(runtime);
  dispatchApplicationCommand(runtime.view, 'group-a.search-trigger', {
    kind: 'mentions',
  });
  runtime.port.command(CommandCode.InsertText, 0, 0, 'fix');
  return { runtime, errors, before, alive: () => !closed };
}

/** The production native mention source config (RustMarkdownEditor). */
const NATIVE_SOURCE = {
  sourceDocumentId: 'doc-1',
  disableMentionTracking: false,
} as const;

/** Source's document menu (MarkdownEditingOverlays): no sources override. */
function renderSource(
  lifetime: CaseLifetime,
  editor: LexicalEditor,
  extra: { entities?: () => EntityItem[] } = {}
) {
  const container = document.createElement('div');
  document.body.append(container);
  lifetime.release(() => container.remove());
  const menu = createMenuOperations();
  menu.openMenu();
  const rendered = render(
    () => (
      <MentionsMenu
        editor={editor}
        menu={menu}
        useBlockBoundary={true}
        showOpenTabs
        disableMentionTracking={false}
        sourceDocumentId="doc-1"
        {...extra}
      />
    ),
    { container }
  );
  lifetime.release(() => rendered.unmount());
  return { container, menu };
}

/** Native's real overlay with its own source config. */
function renderNative(
  lifetime: CaseLifetime,
  session: ReturnType<typeof nativeSession>,
  extra: { entities?: () => EntityItem[] } = {}
) {
  const container = document.createElement('div');
  document.body.append(container);
  lifetime.release(() => container.remove());
  const menu = createMenuOperations();
  menu.openMenu();
  const rendered = render(
    () => (
      <NativeUserMentionsOverlay
        view={session.runtime.view}
        menu={menu}
        source={{ ...NATIVE_SOURCE, ...extra }}
        alive={session.alive}
      />
    ),
    { container }
  );
  lifetime.release(() => rendered.unmount());
  return { container, menu };
}

function useCase(name: string, mobile: boolean) {
  const lifetime = caseLifetime(name);
  const output = process.env.AGENT_SESSION_EXPOSURE_OUT;
  const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  record = (engine, phase, data) => {
    if (!output) return;
    writeFileSync(
      `${output}/${slug}--${engine}--${phase}.json`,
      `${JSON.stringify({ case: name, engine, phase, ...data }, null, 1)}\n`,
      { flag: 'wx' }
    );
  };
  hosts.selects.length = 0;
  takeProvider();
  trackMention.mockClear();
  provider.mobile = mobile;
  lifetime.release(() => {
    provider.mobile = false;
  });
  const scrollDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollIntoView'
  );
  lifetime.release(() => {
    if (scrollDescriptor)
      Object.defineProperty(
        Element.prototype,
        'scrollIntoView',
        scrollDescriptor
      );
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });
  // jsdom has no scrollIntoView; presentation only, as in the Source control.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value() {},
  });
  // Every actual select through either real host is settled and joined
  // before any release; a rejected one is reported with its raw reason.
  lifetime.join(async () => {
    tracking.release();
    const outcomes = await Promise.all(
      hosts.selects.map(({ outcome }) => outcome)
    );
    const reasons = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : []
    );
    if (reasons.length > 0)
      throw new AggregateError(reasons, 'a real select rejected');
  });
  return lifetime;
}

/**
 * Click the agent session row, then require the click to start an actual
 * select on this engine's real host, race tracking entry against that select's
 * actual outcome, and settle tracking once. A lost gate is recorded raw first.
 */
async function pickSession(
  engine: 'source' | 'native',
  container: HTMLElement
) {
  const row = await within(container).findByText('Fix mentions');
  const before = hosts.selects.length;
  tracking.hold();
  fireEvent.click(row);
  const select = hosts.selects[before];
  if (!select || select.engine !== engine) {
    record(engine, 'gate-failed', {
      reason: 'no actual select on this engine',
      engines: hosts.selects.map((entry) => entry.engine),
    });
    throw new Error(`${engine}: the click started no select`);
  }
  const gate = await Promise.race([
    tracking.entered().then(() => 'entered' as const),
    select.outcome,
  ]);
  if (gate !== 'entered') {
    record(engine, 'gate-failed', { outcome: rawOutcome(gate) });
    throw new Error(`${engine}: the select settled before tracking`);
  }
  tracking.settle('mention-uuid');
  return select.outcome;
}

const SOURCE_DESKTOP_SECTIONS = [
  'People',
  'Documents, Agents, & Tasks',
  'Recent agent sessions',
];

test('sections (desktop): the native overlay shows Source’s section labels in order', async () => {
  const lifetime = useCase('sections desktop', false);
  const editor = sourceEditor(lifetime);
  openSourceSearch(editor);
  takeProvider();
  const source = renderSource(lifetime, editor);
  await within(source.container).findAllByText('Ada');
  const sourceLabels = sectionLabels(source.container);
  const sourceProvider = takeProvider();
  record('source', 'sections', {
    labels: sourceLabels,
    provider: sourceProvider,
  });
  const native = renderNative(lifetime, nativeSession(lifetime));
  await within(native.container).findAllByText('Ada');
  const nativeLabels = sectionLabels(native.container);
  const nativeProvider = takeProvider();
  record('native', 'sections', {
    labels: nativeLabels,
    provider: nativeProvider,
  });
  expect(sourceLabels).toEqual(SOURCE_DESKTOP_SECTIONS);
  expect(nativeLabels).toEqual(sourceLabels);
  // Both read sessions through a created, gated session list.
  expect(touchesSessions(sourceProvider)).toEqual({
    created: true,
    read: true,
  });
  expect(touchesSessions(nativeProvider)).toEqual({
    created: true,
    read: true,
  });
});

test('sections (desktop, custom entities): no agent-session list exists on either', async () => {
  const lifetime = useCase('sections custom entities', false);
  const entities = () => [DOCUMENT];
  const editor = sourceEditor(lifetime);
  openSourceSearch(editor);
  takeProvider();
  const source = renderSource(lifetime, editor, { entities });
  await within(source.container).findAllByText('Plan');
  const sourceLabels = sectionLabels(source.container);
  const sourceProvider = takeProvider();
  record('source', 'sections', {
    labels: sourceLabels,
    provider: sourceProvider,
  });
  const native = renderNative(lifetime, nativeSession(lifetime), { entities });
  await within(native.container).findAllByText('Plan');
  const nativeLabels = sectionLabels(native.container);
  const nativeProvider = takeProvider();
  record('native', 'sections', {
    labels: nativeLabels,
    provider: nativeProvider,
  });
  expect(sourceLabels).not.toContain('Recent agent sessions');
  expect(nativeLabels).toEqual(sourceLabels);
  // Custom entities: Hosted creates no session list at all (sessionList is
  // only built when there are no custom entities), so nothing touches it.
  expect(touchesSessions(sourceProvider)).toEqual({
    created: false,
    read: false,
  });
  expect(touchesSessions(nativeProvider)).toEqual({
    created: false,
    read: false,
  });
});

/**
 * The first non-empty candidate snapshot this engine's real mobile list
 * received, within a bound; a missing one is recorded raw before throwing.
 */
async function mobileCandidates(engine: 'source' | 'native') {
  const latest = () =>
    candidates.seen[engine].find((items) => items.length > 0);
  const found = latest();
  if (found) return found;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arrived = await Promise.race([
    new Promise<unknown[]>((resolve) => {
      candidates.notify = () => {
        const items = latest();
        if (items) resolve(items);
      };
    }),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), 1000);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    candidates.notify = () => {};
  });
  if (!arrived) {
    record(engine, 'gate-failed', {
      reason: 'no non-empty mobile candidates',
      seen: candidates.seen[engine],
    });
    throw new Error(`${engine}: the mobile list received no candidates`);
  }
  return arrived;
}

test('mobile (candidate data): the shared mobile list offers the agent session candidate on both', async () => {
  const lifetime = useCase('mobile', true);
  candidates.seen = { source: [], native: [] };
  lifetime.release(() => {
    candidates.engine = undefined;
  });
  const editor = sourceEditor(lifetime);
  openSourceSearch(editor);
  takeProvider();
  candidates.engine = 'source';
  renderSource(lifetime, editor);
  const sourceCandidates = await mobileCandidates('source');
  record('source', 'mobile', {
    candidates: sourceCandidates,
    provider: takeProvider(),
  });
  candidates.engine = 'native';
  renderNative(lifetime, nativeSession(lifetime));
  const nativeCandidates = await mobileCandidates('native');
  record('native', 'mobile', {
    candidates: nativeCandidates,
    provider: takeProvider(),
  });
  expect(sourceCandidates).toContainEqual({
    kind: 'agentSession',
    bucket: 'agent_session',
    id: 'session',
  });
  expect(nativeCandidates).toEqual(sourceCandidates);
});

test('insert (desktop): picking the agent session in the real overlay matches Source', async () => {
  const lifetime = useCase('insert desktop', false);
  const editor = sourceEditor(lifetime);
  const sourceBefore = sourceModel(editor);
  record('source', 'before', sourceBefore);
  openSourceSearch(editor);
  const source = renderSource(lifetime, editor);
  trackMention.mockClear();
  const sourceOutcome = await pickSession('source', source.container);
  editor.read(() => {});
  const sourceAfter = sourceModel(editor);
  const sourceCalls = trackMention.mock.calls.map((call) => [...call]);
  record('source', 'after', {
    ...sourceAfter,
    outcome: rawOutcome(sourceOutcome),
    calls: sourceCalls,
  });

  const session = nativeSession(lifetime);
  record('native', 'before', session.before);
  const native = renderNative(lifetime, session);
  await within(native.container).findAllByText('Ada');
  record('native', 'rows', {
    sessionRows: within(native.container).queryAllByText('Fix mentions').length,
  });
  trackMention.mockClear();
  const nativeOutcome = await pickSession('native', native.container);
  const nativeAfter = nativeModel(session.runtime);
  const nativeCalls = trackMention.mock.calls.map((call) => [...call]);
  record('native', 'after', {
    ...nativeAfter,
    outcome: rawOutcome(nativeOutcome),
    calls: nativeCalls,
    errors: session.errors.map(String),
  });

  expect(sourceOutcome).toEqual({ status: 'fulfilled' });
  expect(nativeOutcome).toEqual({ status: 'fulfilled' });
  expect(sourceCalls).toEqual([['doc-1', 'agent_session', 'session']]);
  expect(nativeCalls).toEqual(sourceCalls);
  const ids = createIdPairing();
  for (const [phase, sourcePhase, nativePhase] of [
    ['before', sourceBefore, session.before],
    ['after', sourceAfter, nativeAfter],
  ] as const) {
    compareRoots(
      sourcePhase.json.root,
      nativePhase.json.root,
      {
        // Source's root keeps its import id; native's root has none yet
        // (C-ROOT-ID-PRESENCE-01, open, fix pending).
        source: 'id',
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
  expect(session.errors).toEqual([]);
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
