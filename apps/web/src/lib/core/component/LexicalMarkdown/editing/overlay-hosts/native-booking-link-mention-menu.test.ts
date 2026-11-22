/** @vitest-environment jsdom */

import 'fake-indexeddb/auto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import {
  type EventType,
  newEventType,
  type SchedulingProfile,
} from '@app/features/scheduling/core/types';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import { registerRichText } from '@lexical/rich-text';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  type BookingLinkMentionInfo,
  BookingLinkMentionNode,
} from '@macro-inc/lexical-core';
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
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
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
import { ok } from 'neverthrow';
import {
  createComponent,
  createEffect,
  createRoot,
  type ParentProps,
} from 'solid-js';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { useBookingLinkMention } from '../../component/menu/MentionsMenu/hooks/useBookingLinkMention';
import {
  createItemHandler,
  handleBookingLinkMentionWithInsertion,
} from '../../component/menu/MentionsMenu/utils/mentionHandlers';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import {
  createNativeBookingLinkMentionContext,
  createNativeBookingLinkMentionViews,
} from '../../decorator-host/native-booking-views';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import {
  INSERT_BOOKING_LINK_MENTION_COMMAND,
  mentionsPlugin,
  REMOVE_INLINE_SEARCH_COMMAND,
  TYPE_AT_SYMBOL_COMMAND,
} from '../../plugins/mentions/mentionsPlugin';
import { theme } from '../../theme';
import type { BookingLinkMentionItem } from '../../utils/mentionsUtils';
import { createNativeUserMentionMenuHost } from './native-user-mention-menu';
import {
  compareRoots,
  createIdPairing,
  serializedJSON,
} from './source-native-model';
import { type CaseLifetime, caseLifetime } from './test-case-lifetime';

// Source handleBookingLinkMention (mentionHandlers.ts) removes the search and
// dispatches INSERT_BOOKING_LINK_MENTION_COMMAND synchronously, with no
// tracking. Every paired row runs Source with its app wrapper and real node
// ids, the real mentions plugin and the menu's item handler, then native with
// the applied host, on the same imported input and the same item. Items come
// from the real useBookingLinkMention hook over a fixture scheduling response,
// never hand-built. Native-only rows cover the window native has and Source
// does not (between the settled search removal and the insert admission); they
// are recorded and named separately, and compared, where they insert, against
// Source's own command on the same selection (a command oracle, not the menu).

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

function event(
  id: string,
  title: string,
  slug: string,
  enabled: boolean
): EventType {
  return {
    ...newEventType('schedule', ['owner'], false),
    id,
    title,
    slug,
    enabled,
  };
}
/** The personal profile: an id and a slug that need encoding, and a disabled link. */
const PERSONAL: SchedulingProfile = {
  id: 'fixture profile/ä',
  name: 'Me',
  description: '',
  schedules: [],
  eventTypes: [
    event('intro', 'Intro & call', 'intro & call/1', true),
    event('hidden', 'Hidden', 'hidden', false),
    event('blank', '', 'blank-title', true),
  ],
  revision: 1,
};
const TEAM: SchedulingProfile = {
  id: 'team-profile',
  name: 'Team',
  description: '',
  schedules: [],
  eventTypes: [event('sync', 'Team sync', 'team-sync', true)],
  revision: 1,
};

const { trackMention, settings } = vi.hoisted(() => ({
  trackMention: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('@core/signal/mention', () => ({ trackMention }));
vi.mock('@service-email/scheduling', () => ({
  schedulingClient: { settings },
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    data: { team: { id: 'team-1', name: 'Design team' } },
  }),
}));

// The same data-source and presentation-only providers as the agent-session
// pairing; useBookingLinkMention itself is real.
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    usesRecordSelection: () => false,
    usesSearchProjection: () => false,
    useList: () => ({
      items: () => [],
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
  '../../component/menu/MentionsMenu/hooks/useCalendarEventMention',
  () => ({ useCalendarEventMention: () => ({ events: () => [] }) })
);
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

declare const jsdom: { reconfigure(options: { url: string }): void };

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

/** The booking links the real menu hook offers for the fixture response. */
async function menuBookingLinks(
  lifetime: CaseLifetime
): Promise<BookingLinkMentionItem[]> {
  settings.mockReset();
  settings.mockImplementation(async (teamId?: string) =>
    ok({ profile: teamId === 'team-1' ? TEAM : PERSONAL })
  );
  const client = new QueryClient();
  lifetime.release(() => client.clear());
  const links = Promise.withResolvers<BookingLinkMentionItem[]>();
  createRoot((dispose) => {
    lifetime.release(dispose);
    createComponent(QueryClientProvider, {
      client,
      get children() {
        const hook = useBookingLinkMention({
          enabled: () => true,
          searchTerm: () => '',
        });
        createEffect(() => {
          const items = hook.bookingLinks();
          if (!hook.isLoading() && items.length === 3) links.resolve(items);
        });
        return null;
      },
    });
  });
  const timer = setTimeout(
    () => links.reject(new Error('The real hook offered no booking links')),
    1000
  );
  const offered = links.promise.finally(() => clearTimeout(timer));
  lifetime.join(() => observe(offered));
  return await offered;
}

test('items: the real menu hook offers the enabled personal and team links', async () => {
  const lifetime = caseLifetime('items');
  expect(await menuBookingLinks(lifetime)).toEqual([
    {
      kind: 'bookingLink',
      id: 'fixture profile/ä:intro',
      data: {
        profileId: 'fixture profile/ä',
        slug: 'intro & call/1',
        title: 'Intro & call',
        durationMinutes: 30,
        owner: 'Personal',
      },
    },
    {
      kind: 'bookingLink',
      id: 'fixture profile/ä:blank',
      data: {
        profileId: 'fixture profile/ä',
        slug: 'blank-title',
        title: '',
        durationMinutes: 30,
        owner: 'Personal',
      },
    },
    {
      kind: 'bookingLink',
      id: 'team-profile:sync',
      data: {
        profileId: 'team-profile',
        slug: 'team-sync',
        title: 'Team sync',
        durationMinutes: 30,
        owner: 'Design team',
      },
    },
  ]);
  expect(settings.mock.calls).toEqual([[undefined], ['team-1']]);
});

type Admission = {
  name: string;
  payload: unknown;
  /** How many times the host's message factory ran for this admission. */
  factoryCalls: number;
  result: unknown;
};
type Runtime = ReturnType<typeof mountLocalSessionView>;
/** What a boundary may touch: the real session, not the host under test. */
type BoundaryTarget = Pick<Runtime, 'view' | 'port' | 'executor'> & {
  lifetime: CaseLifetime;
  close(): Promise<void>;
  revokeEdit(): void;
};
/** Runs after the removal admission settles, before the host sees its result. */
type Boundary = (target: BoundaryTarget) => unknown;

/** A real native session on INPUT_STATE, caret at 6, with a live mention search. */
function mount(
  lifetime: CaseLifetime,
  caller: Caller,
  afterRemoval?: Boundary
) {
  setDecorator(BookingLinkMentionNode, () => null);
  lifetime.release(clearDecorators);
  const root = document.createElement('div');
  document.body.append(root);
  lifetime.release(() => root.remove());
  const context = createNativeBookingLinkMentionContext(theme);
  lifetime.release(() => context.dispose());
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroDecoratorViews(
      registerMacroElementViews(createBuiltinRegistry()),
      createNativeBookingLinkMentionViews(context)
    ),
    {
      namespace: 'booking-link-menu',
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
          'booking-link-menu'
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
  const admissions: Admission[] = [];
  const admit = runtime.port.inputSettledIfSessionEdit;
  if (!admit) throw new Error('Missing settled session edit admission');
  const realAdmit = admit.bind(runtime.port);
  const host = createNativeUserMentionMenuHost(
    runtime.view,
    {
      sourceDocumentId: caller.sourceDocumentId ?? '',
      blockName: caller.blockName,
      disableMentionTracking: caller.disableMentionTracking ?? false,
    },
    () => !closed
  );
  const mounted = {
    ...runtime,
    host,
    lifetime,
    before,
    errors,
    admissions,
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
  const admitSpy = vi
    .spyOn(runtime.port, 'inputSettledIfSessionEdit')
    .mockImplementation(async (...args: Parameters<typeof realAdmit>) => {
      const [factory, ...rest] = args;
      const admission: Admission = {
        name: '',
        payload: undefined,
        factoryCalls: 0,
        result: undefined,
      };
      const counted: typeof factory = () => {
        admission.factoryCalls += 1;
        const message = factory();
        admission.name = message.name;
        admission.payload = JSON.parse(message.json);
        return message;
      };
      const result = await realAdmit(counted, ...rest);
      admission.result = result;
      admissions.push(admission);
      if (admission.name === 'group-a.search-remove' && afterRemoval)
        await afterRemoval(mounted);
      return result;
    });
  lifetime.release(() => admitSpy.mockRestore());
  return mounted;
}

type Caller = {
  sourceDocumentId?: string;
  blockName?: 'md' | 'channel' | 'chat';
  disableMentionTracking?: boolean;
};
const TRACKED = { sourceDocumentId: 'doc-1', blockName: 'md' } as const;

/** A change made in native's window, on the actual post-removal nodes. */
type Pending =
  | 'expanded-forward'
  | 'expanded-backward'
  | 'element'
  | 'null'
  | 'text'
  | 'replace-state';

type Outcome =
  | { status: 'fulfilled' }
  | { status: 'rejected'; reason: unknown };

function observe(running: Promise<unknown>): Promise<Outcome> {
  return running.then(
    (): Outcome => ({ status: 'fulfilled' }),
    (reason: unknown): Outcome => ({ status: 'rejected', reason })
  );
}

/**
 * Observes actual work and joins it to the case before anyone awaits it: no
 * release runs while it is pending, and work that does not settle retains the
 * case's resources and stops the job (test-case-lifetime.ts).
 */
function joined(lifetime: CaseLifetime, running: Promise<unknown>) {
  const outcome = observe(running);
  lifetime.join(() => outcome);
  return outcome;
}

function rawOutcome(outcome: Outcome) {
  return outcome.status === 'fulfilled'
    ? outcome
    : {
        status: outcome.status,
        name: outcome.reason instanceof Error ? outcome.reason.name : undefined,
        message:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
      };
}

/**
 * Raw observations of one row, each written at once to its own file before
 * any later step can fail; wx never overwrites.
 */
function rowSink(name: string) {
  const output = process.env.BOOKING_LINK_MENU_OUT;
  const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return (
    engine: 'source' | 'source-oracle' | 'native',
    phase: string,
    data: object
  ) => {
    if (!output) return;
    writeFileSync(
      `${output}/${slug}--${engine}--${phase}.json`,
      `${JSON.stringify({ row: name, engine, phase, ...data }, null, 1)}\n`,
      { flag: 'wx' }
    );
  };
}

/**
 * This row's page origin for both engines. The current origin's restoration
 * is owned before the change, so no failure can leave the origin changed.
 */
function setOrigin(lifetime: CaseLifetime, url: string | undefined) {
  if (url === undefined) return;
  const previous = window.location.href;
  lifetime.release(() => jsdom.reconfigure({ url: previous }));
  jsdom.reconfigure({ url });
  expect(window.location.href).toBe(url);
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

/** Opens the search and records every booking payload Source dispatches. */
function openSourceSearch(lifetime: CaseLifetime, editor: LexicalEditor) {
  expect(editor.dispatchCommand(TYPE_AT_SYMBOL_COMMAND, undefined)).toBe(true);
  editor.update(() => $getSelection()?.insertText('fix'), { discrete: true });
  const observed = { removed: 0, payloads: [] as BookingLinkMentionInfo[] };
  lifetime.release(
    editor.registerCommand(
      REMOVE_INLINE_SEARCH_COMMAND,
      () => {
        observed.removed += 1;
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    )
  );
  lifetime.release(
    editor.registerCommand(
      INSERT_BOOKING_LINK_MENTION_COMMAND,
      (payload) => {
        observed.payloads.push(payload);
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    )
  );
  return observed;
}

function applySource(editor: LexicalEditor, pending: Pending) {
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

function applyNative(mounted: BoundaryTarget, pending: Pending) {
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

type Phase = 'before' | 'atRemoval' | 'afterChange' | 'after';

/**
 * The given phases through one persistent id pairing; root contracts as in
 * the agent pairing. `replacedFrom` is the first phase after a same-view
 * state replacement, from which Source's root carries no id.
 */
function compareModels(
  phases: readonly Phase[],
  source: Partial<Record<Phase, Model>>,
  native: Partial<Record<Phase, Model>>,
  replacedFrom?: Phase
) {
  const ids = createIdPairing();
  let replaced = false;
  for (const phase of phases) {
    if (phase === replacedFrom) replaced = true;
    const sourcePhase = source[phase];
    const nativePhase = native[phase];
    if (!sourcePhase || !nativePhase)
      throw new Error(`${phase} not observed on both engines`);
    compareRoots(
      sourcePhase.json.root,
      nativePhase.json.root,
      {
        // Source's root id from import, dropped by a same-view replacement;
        // native's root has none yet (C-ROOT-ID-PRESENCE-01, open), so root
        // ids are not paired.
        source: replaced ? 'absent' : 'id',
        // C-R003-PERSISTED-ROOT-METADATA-01: a ruled named difference.
        native: { documentMetadata: { version: 11 } },
      },
      ids,
      phase
    );
    expect(nativePhase.selection, `${phase} selection`).toEqual(
      sourcePhase.selection
    );
  }
}

type Row = {
  name: string;
  caller: Caller;
  /** Index into the real hook's items. */
  item: number;
  /** The page origin for both engines; jsdom's default when absent. */
  origin?: string;
  /** The exact url the shared builder must produce for this row. */
  url: string;
};

/** Source first, to completion, then native; both through the same row. */
async function pairedRow(row: Row) {
  const lifetime = caseLifetime(row.name);
  const record = rowSink(row.name);
  const item = (await menuBookingLinks(lifetime))[row.item];
  if (!item) throw new Error('Missing real booking item');
  record('source', 'item', { item });
  setOrigin(lifetime, row.origin);
  trackMention.mockReset();

  const editor = sourceEditor(lifetime);
  const sourceBefore = sourceModel(editor);
  record('source', 'before', sourceBefore);
  const observed = openSourceSearch(lifetime, editor);
  const sourceResult = await joined(
    lifetime,
    createItemHandler({
      editor,
      blockId: row.caller.sourceDocumentId,
      blockName: row.caller.blockName,
      disableMentionTracking: row.caller.disableMentionTracking,
    })(item)
  );
  const sourceCalls = trackMention.mock.calls.map((call) => [...call]);
  record('source', 'outcome', {
    outcome: rawOutcome(sourceResult),
    removed: observed.removed,
    payloads: observed.payloads,
    calls: sourceCalls,
  });
  editor.read(() => {});
  const sourceAfter = sourceModel(editor);
  record('source', 'after', sourceAfter);

  trackMention.mockReset();
  const mounted = mount(lifetime, row.caller);
  record('native', 'before', mounted.before);
  const nativeResult = await joined(
    lifetime,
    Promise.resolve(mounted.host.select(item))
  );
  const nativeCalls = trackMention.mock.calls.map((call) => [...call]);
  record('native', 'outcome', {
    outcome: rawOutcome(nativeResult),
    admissions: mounted.admissions,
    calls: nativeCalls,
    errors: mounted.errors.map(String),
  });
  const nativeAfter = nativeModel(mounted);
  record('native', 'after', nativeAfter);

  expect(sourceResult).toEqual({ status: 'fulfilled' });
  expect(observed.removed).toBe(1);
  // The shared builder's exact url, pinned per origin.
  expect(observed.payloads).toEqual([
    {
      profileId: item.data.profileId,
      slug: item.data.slug,
      label: item.data.title,
      url: row.url,
    },
  ]);
  compareModels(
    ['before', 'after'],
    { before: sourceBefore, after: sourceAfter },
    { before: mounted.before, after: nativeAfter }
  );
  expect(nativeResult).toEqual(sourceResult);
  // The settled removal, then exactly one booking admission whose payload is
  // built once, at admission, and equals Source's dispatched payload.
  // A settled success is { status, handled } (InputSettlement, port.ts:100;
  // handled from FLAG_HANDLED, session-port.ts:801-805).
  expect(
    mounted.admissions.map(({ name, factoryCalls, result }) => ({
      name,
      factoryCalls,
      result,
    }))
  ).toEqual([
    {
      name: 'group-a.search-remove',
      factoryCalls: 1,
      result: { status: 'success', handled: true },
    },
    {
      name: 'group-b.insert-booking-link-mention',
      factoryCalls: 1,
      result: { status: 'success', handled: true },
    },
  ]);
  expect(mounted.admissions[1]?.payload).toEqual(observed.payloads[0]);
  // Source's booking handler never tracks; neither does native.
  expect(sourceCalls).toEqual([]);
  expect(nativeCalls).toEqual([]);
  expect(mounted.errors).toEqual([]);
}

const PAIRED: Row[] = [
  {
    name: 'row: personal link at the caret on localhost',
    caller: TRACKED,
    item: 0,
    url: 'https://dev.macro.com/app/book/fixture%20profile%2F%C3%A4/intro%20%26%20call%2F1',
  },
  {
    name: 'row: empty title keeps an empty label',
    caller: TRACKED,
    item: 1,
    url: 'https://dev.macro.com/app/book/fixture%20profile%2F%C3%A4/blank-title',
  },
  {
    name: 'row: team link',
    caller: TRACKED,
    item: 2,
    url: 'https://dev.macro.com/app/book/team-profile/team-sync',
  },
  {
    name: 'row: www host drops the www prefix',
    caller: TRACKED,
    item: 0,
    origin: 'https://www.macro.com/app',
    url: 'https://macro.com/app/book/fixture%20profile%2F%C3%A4/intro%20%26%20call%2F1',
  },
  {
    name: 'row: other non-local host is kept',
    caller: TRACKED,
    item: 2,
    origin: 'https://app.example.test/app',
    url: 'https://app.example.test/app/book/team-profile/team-sync',
  },
  {
    name: 'row: tracking disabled caller',
    caller: { ...TRACKED, disableMentionTracking: true },
    item: 0,
    url: 'https://dev.macro.com/app/book/fixture%20profile%2F%C3%A4/intro%20%26%20call%2F1',
  },
  {
    name: 'row: channel caller',
    caller: { sourceDocumentId: 'doc-1', blockName: 'channel' },
    item: 2,
    url: 'https://dev.macro.com/app/book/team-profile/team-sync',
  },
];

for (const row of PAIRED)
  test(row.name, async () => {
    await pairedRow(row);
  });

// Native-only: Source dispatches its insert synchronously after the removal,
// so it has no window here. Native settles the removal first; a selection or
// state change in that window is honored by the insert command, as Source's
// own command would on the same selection (the Source oracle below). Every
// phase is persisted the instant it is observed, before anything later runs.
const BOUNDARY: Pending[] = [
  'expanded-forward',
  'expanded-backward',
  'element',
  'null',
  'text',
  'replace-state',
];
for (const pending of BOUNDARY)
  test(`native boundary: ${pending} after the settled removal inserts as Source's command does`, async () => {
    const name = `native boundary ${pending}`;
    const lifetime = caseLifetime(name);
    const record = rowSink(name);
    const item = (await menuBookingLinks(lifetime))[0];
    if (!item) throw new Error('Missing real booking item');

    // Oracle: Source's app wrapper, the same removal, the same change, then
    // Source's own handler and command on that selection.
    const oracle: Partial<Record<Phase, Model>> = {};
    const editor = sourceEditor(lifetime);
    oracle.before = sourceModel(editor);
    record('source-oracle', 'before', oracle.before);
    const observed = openSourceSearch(lifetime, editor);
    editor.dispatchCommand(REMOVE_INLINE_SEARCH_COMMAND, undefined);
    editor.read(() => {});
    oracle.atRemoval = sourceModel(editor);
    record('source-oracle', 'atRemoval', oracle.atRemoval);
    applySource(editor, pending);
    editor.read(() => {});
    oracle.afterChange = sourceModel(editor);
    record('source-oracle', 'afterChange', oracle.afterChange);
    const oracleResult = await joined(
      lifetime,
      handleBookingLinkMentionWithInsertion(item, () => ({
        insert(buildPayload) {
          editor.dispatchCommand(
            INSERT_BOOKING_LINK_MENTION_COMMAND,
            buildPayload()
          );
        },
      }))
    );
    record('source-oracle', 'outcome', {
      outcome: rawOutcome(oracleResult),
      removed: observed.removed,
      payloads: observed.payloads,
    });
    editor.read(() => {});
    oracle.after = sourceModel(editor);
    record('source-oracle', 'after', oracle.after);

    const phases: Partial<Record<Phase, Model>> = {};
    const mounted = mount(lifetime, TRACKED, (current) => {
      phases.atRemoval = nativeModel(current);
      record('native', 'atRemoval', phases.atRemoval);
      applyNative(current, pending);
      phases.afterChange = nativeModel(current);
      record('native', 'afterChange', phases.afterChange);
    });
    phases.before = mounted.before;
    record('native', 'before', phases.before);
    const result = await joined(
      lifetime,
      Promise.resolve(mounted.host.select(item))
    );
    record('native', 'outcome', {
      outcome: rawOutcome(result),
      admissions: mounted.admissions,
      errors: mounted.errors.map(String),
    });
    phases.after = nativeModel(mounted);
    record('native', 'after', phases.after);

    expect(oracleResult).toEqual({ status: 'fulfilled' });
    expect(observed.removed).toBe(1);
    expect(observed.payloads).toHaveLength(1);
    expect(result).toEqual({ status: 'fulfilled' });
    expect(
      mounted.admissions.map(({ name, result }) => [name, result])
    ).toEqual([
      ['group-a.search-remove', { status: 'success', handled: true }],
      [
        'group-b.insert-booking-link-mention',
        { status: 'success', handled: true },
      ],
    ]);
    expect(mounted.admissions[1]?.factoryCalls).toBe(1);
    expect(mounted.admissions[1]?.payload).toEqual(observed.payloads[0]);
    compareModels(
      ['before', 'atRemoval', 'afterChange', 'after'],
      oracle,
      phases,
      pending === 'replace-state' ? 'afterChange' : undefined
    );
    expect(mounted.errors).toEqual([]);
  });

test('native boundary: edit access revoked after the settled removal is refused', async () => {
  const name = 'native boundary edit access';
  const lifetime = caseLifetime(name);
  const record = rowSink(name);
  const item = (await menuBookingLinks(lifetime))[0];
  if (!item) throw new Error('Missing real booking item');
  let atRemoval: Model | undefined;
  const mounted = mount(lifetime, TRACKED, (current) => {
    atRemoval = nativeModel(current);
    record('native', 'atRemoval', atRemoval);
    current.revokeEdit();
  });
  record('native', 'before', mounted.before);
  const result = await joined(
    lifetime,
    Promise.resolve(mounted.host.select(item))
  );
  record('native', 'outcome', {
    outcome: rawOutcome(result),
    admissions: mounted.admissions,
    errors: mounted.errors.map(String),
  });
  const after = nativeModel(mounted);
  record('native', 'after', after);
  expect(result).toEqual({ status: 'fulfilled' });
  // The refusal is the settled admission's own result: an unauthorized
  // settled input is cancelled before its factory runs (session-port.ts:510-515
  // passes the access predicate as `admit`; executor.ts:396-404;
  // input-session-edit-settled.test.ts:95-118). The spy's name '' and payload
  // undefined are its sentinels for "no factory ran": no payload is built.
  expect(mounted.admissions).toEqual([
    {
      name: 'group-a.search-remove',
      payload: {},
      factoryCalls: 1,
      result: { status: 'success', handled: true },
    },
    {
      name: '',
      payload: undefined,
      factoryCalls: 0,
      result: { status: 'cancelled', reason: 'session-access' },
    },
  ]);
  expect(atRemoval).toBeDefined();
  expect(after).toEqual(atRemoval);
  expect(mounted.errors).toEqual([]);
});

test('native boundary: session closed after the settled removal inserts nothing', async () => {
  const name = 'native boundary closed';
  const lifetime = caseLifetime(name);
  const record = rowSink(name);
  const item = (await menuBookingLinks(lifetime))[0];
  if (!item) throw new Error('Missing real booking item');
  const mounted = mount(lifetime, TRACKED, (current) => {
    record('native', 'atRemoval', nativeModel(current));
    const closing = current.close();
    current.lifetime.join(() => observe(closing));
    return closing;
  });
  record('native', 'before', mounted.before);
  const result = await joined(
    lifetime,
    Promise.resolve(mounted.host.select(item))
  );
  record('native', 'outcome', {
    outcome: rawOutcome(result),
    admissions: mounted.admissions,
    mounted: mounted.view.isMounted,
    errors: mounted.errors.map(String),
  });
  expect(result).toEqual({ status: 'fulfilled' });
  expect(mounted.view.isMounted).toBe(false);
  // Nothing is offered for admission once the session has closed.
  expect(mounted.admissions.map(({ name }) => name)).toEqual([
    'group-a.search-remove',
  ]);
  expect(mounted.errors).toEqual([]);
});

// C-NATIVE-GENERATION-RETIRE-NO-RETARGET-01 guard-branch diagnostic: no fixture
// path retires the key generation inside one live view, so ONE observation is
// injected (keyGeneration reads generation + 1 after the removal settles); the
// session, admission and commands stay real.
test('native boundary: injected key generation change after the settled removal inserts nothing (C-NATIVE-GENERATION-RETIRE-NO-RETARGET-01)', async () => {
  const name = 'native boundary generation';
  const lifetime = caseLifetime(name);
  const record = rowSink(name);
  const item = (await menuBookingLinks(lifetime))[0];
  if (!item) throw new Error('Missing real booking item');
  let atRemoval: Model | undefined;
  const mounted = mount(lifetime, TRACKED, (current) => {
    atRemoval = nativeModel(current);
    record('native', 'atRemoval', atRemoval);
    const generation = current.view.mirror.keyGeneration;
    if (generation === null) throw new Error('Missing actual view generation');
    // INJECTED: the only non-real observation in this row.
    const injection = vi
      .spyOn(current.view.mirror, 'keyGeneration', 'get')
      .mockReturnValue(generation + 1);
    current.lifetime.release(() => injection.mockRestore());
  });
  record('native', 'before', mounted.before);
  const result = await joined(
    lifetime,
    Promise.resolve(mounted.host.select(item))
  );
  record('native', 'outcome', {
    outcome: rawOutcome(result),
    admissions: mounted.admissions,
    errors: mounted.errors.map(String),
  });
  const after = nativeModel(mounted);
  record('native', 'after', after);
  expect(result).toEqual({ status: 'fulfilled' });
  expect(mounted.admissions.map(({ name }) => name)).toEqual([
    'group-a.search-remove',
  ]);
  expect(atRemoval).toBeDefined();
  expect(after).toEqual(atRemoval);
  expect(mounted.errors).toEqual([]);
});

type Model = {
  json: { root: Record<string, unknown> & { children: unknown } };
  selection: unknown;
};
function nativeModel(runtime: Pick<Runtime, 'view' | 'executor'>): Model {
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
    // Source's SERIALIZED form, like for like with native's parsed string.
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
