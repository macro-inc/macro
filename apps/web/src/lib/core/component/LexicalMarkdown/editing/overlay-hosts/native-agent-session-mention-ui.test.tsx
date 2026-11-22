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
import { fireEvent, render, screen } from '@solidjs/testing-library';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical';
import { createRoot, type ParentProps } from 'solid-js';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { HostedMentionsMenu } from '../../component/menu/MentionsMenu/HostedMentionsMenu';
import { createItemHandler } from '../../component/menu/MentionsMenu/utils/mentionHandlers';
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
import { createNativeUserMentionMenuHost } from './native-user-mention-menu';
import {
  compareRoots,
  createIdPairing,
  type IdPairing,
  serializedJSON,
} from './source-native-model';
import { type CaseLifetime, caseLifetime } from './test-case-lifetime';

// The model oracle is Source run in this test: the app wrapper with real node
// ids (as qualified for Query, native-query-callback.test.ts), the real
// mentions plugin and the menu's item handler, on the exact native input
// string. That closing and unmounting the menu while tracking is pending does
// not cancel the insertion is the Source UI observation of the agent-session
// control (link-diag-97db/agent-session-control run-03, receipt 74ee5c2f).

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

test('ui: menu closed and unmounted while pending still inserts', async () => {
  // Every release waits for the menu's actual select (test-case-lifetime.ts).
  const lifetime = caseLifetime('ui: menu closed and unmounted while pending');
  // With AGENT_SESSION_UI_OUT set, the raw models reach that file on every
  // exit, before any release; a write failure is a secondary error after the
  // body's own.
  const output = process.env.AGENT_SESSION_UI_OUT;
  if (output)
    lifetime.join(async () => {
      writeFileSync(output, `${JSON.stringify({ records }, null, 1)}\n`, {
        flag: 'wx',
      });
    });
  // Source first, to completion, so its tracking double is reset before native.
  const oracle = await sourceOracle(lifetime);
  setDecorator(AgentSessionMentionNode, () => null);
  lifetime.release(clearDecorators);
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
  quickAccessItems.agentSessions = [{ ...SESSION, kind: 'entity' }];
  lifetime.release(() => {
    quickAccessItems.agentSessions = [];
  });

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
      namespace: 'agent-session-menu-ui',
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
          'agent-session-menu-ui'
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
  const ids = createIdPairing();
  pairModels('before', oracle.before, nativeModel(runtime), ids);
  dispatchApplicationCommand(runtime.view, 'group-a.search-trigger', {
    kind: 'mentions',
  });
  runtime.port.command(CommandCode.InsertText, 0, 0, 'fix');

  // Each admission's factory is wrapped: the real admission is the only caller,
  // and the command name is captured when it materializes the message.
  const admissions: { name?: string; materialized: number; result: unknown }[] =
    [];
  const admit = runtime.port.inputSettledIfSessionEdit;
  if (!admit) throw new Error('Missing settled session edit admission');
  const realAdmit = admit.bind(runtime.port);
  const admitSpy = vi
    .spyOn(runtime.port, 'inputSettledIfSessionEdit')
    .mockImplementation(
      async (
        factory: Parameters<typeof realAdmit>[0],
        options?: Parameters<typeof realAdmit>[1]
      ) => {
        const admission: (typeof admissions)[number] = {
          materialized: 0,
          result: undefined,
        };
        admissions.push(admission);
        const result = await realAdmit(() => {
          const message = factory();
          admission.materialized++;
          admission.name = message.name;
          return message;
        }, options);
        admission.result = result;
        return result;
      }
    );
  lifetime.release(() => admitSpy.mockRestore());

  const tracking = Promise.withResolvers<string | undefined>();
  const entered = Promise.withResolvers<void>();
  let settled = false;
  const settle = (value: string | undefined) => {
    if (settled) throw new Error('Tracking settled twice');
    settled = true;
    tracking.resolve(value);
  };
  trackMention.mockReset();
  trackMention.mockImplementation(() => {
    entered.resolve();
    return tracking.promise;
  });

  // The menu fires select and forgets it; the call-through keeps the actual
  // promise so the test can join it.
  type Outcome =
    | { status: 'fulfilled' }
    | { status: 'rejected'; reason: unknown };
  const selects: Promise<Outcome>[] = [];
  const selected = Promise.withResolvers<void>();
  lifetime.join(async () => {
    if (!settled) settle(undefined);
    const joined = await Promise.all(selects);
    // The body passes only on a fulfilled select, so any rejection is a
    // secondary error after the body's primary failure.
    const reasons = joined.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : []
    );
    if (reasons.length > 0)
      throw new AggregateError(reasons, 'select rejected');
  });

  // The overlay's own wiring (NativeUserMentionsOverlay), with agentSessions
  // as the only source so the row under test is the one shown.
  const menu = createMenuOperations();
  menu.openMenu();
  const rendered = render(() => (
    <HostedMentionsMenu
      menu={menu}
      users={() => []}
      sourceDocumentId="doc-1"
      useBlockBoundary={true}
      showOpenTabs
      sources={['agentSessions']}
      includeGroups={false}
      includeContacts={false}
      createHost={(blockId) => {
        const host = createNativeUserMentionMenuHost(
          runtime.view,
          {
            blockName: 'md',
            sourceDocumentId: blockId ?? 'doc-1',
            disableMentionTracking: false,
          },
          () => !closed
        );
        return {
          root: () => host.root(),
          closeSearch: () => host.closeSearch(),
          select(item) {
            const selecting = Promise.resolve(host.select(item));
            selects.push(
              selecting.then(
                (): Outcome => ({ status: 'fulfilled' }),
                (reason: unknown): Outcome => ({ status: 'rejected', reason })
              )
            );
            selected.resolve();
            return selecting;
          },
        };
      }}
    />
  ));
  lifetime.release(() => rendered.unmount());

  fireEvent.click(await screen.findByText('Fix mentions'));
  await selected.promise;
  await Promise.race([entered.promise, ...selects]);
  expect(trackMention).toHaveBeenCalledExactlyOnceWith(
    'doc-1',
    'agent_session',
    'session'
  );
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  expect(menu.isOpen()).toBe(false);
  rendered.unmount();
  expect(
    [...runtime.view.mirror.values()].some(
      (node) => node.type === 'agent-session-mention'
    )
  ).toBe(false);

  settle('mention-uuid');
  expect(selects).toHaveLength(1);
  expect(await selects[0]).toEqual({ status: 'fulfilled' });
  expect(admissions).toMatchObject([
    {
      name: 'group-a.search-remove',
      materialized: 1,
      result: { status: 'success' },
    },
    {
      name: 'group-b.insert-agent-session-mention',
      materialized: 1,
      result: { status: 'success' },
    },
  ]);

  pairModels('after', oracle.after, nativeModel(runtime), ids);
  expect(errors).toEqual([]);
});

type Model = {
  json: { root: Record<string, unknown> & { children: unknown } };
  selection: unknown;
};
const records: unknown[] = [];

/**
 * Raw models are recorded, then compared: node ids through the persisting
 * pairing, every other field exactly. The roots differ only in their own `$`:
 * Source's carries its id, native's the Macro document metadata, written here
 * literally.
 */
function pairModels(
  phase: 'before' | 'after',
  source: Model,
  native: Model,
  ids: IdPairing
) {
  records.push({ phase, source, native });
  compareRoots(
    source.json.root,
    native.json.root,
    {
      // Source's root keeps its import id here (no replacement); native's root
      // has none yet (C-ROOT-ID-PRESENCE-01, open, fix pending).
      source: 'id',
      // Native's current root metadata, a ruled named difference from Source
      // (C-R003-PERSISTED-ROOT-METADATA-01); not parity.
      native: { documentMetadata: { version: 11 } },
    },
    ids,
    `${phase} root`
  );
  expect(native.selection).toEqual(source.selection);
  records.push({ phase, idPairing: [...ids.forward] });
}

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

/**
 * Source with its app wrapper and real node ids: parse the exact input,
 * initialize ids, place the caret, open the search through the real '@'
 * command and type 'fix', then run the menu's item handler with tracking.
 */
async function sourceOracle(lifetime: CaseLifetime) {
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
      if (!text) throw new Error('Source imported text missing');
      text.selectStart();
      const selected = $getSelection();
      if (!$isRangeSelection(selected))
        throw new Error('Source imported range missing');
      selected.anchor.set(text.getKey(), 6, 'text');
      selected.focus.set(text.getKey(), 6, 'text');
    },
    { discrete: true }
  );
  const before = sourceModel(editor);
  expect(editor.dispatchCommand(TYPE_AT_SYMBOL_COMMAND, undefined)).toBe(true);
  editor.update(() => $getSelection()?.insertText('fix'), { discrete: true });
  trackMention.mockReset();
  trackMention.mockResolvedValue('mention-uuid');
  await createItemHandler({ editor, blockId: 'doc-1', blockName: 'md' })(
    SESSION
  );
  editor.read(() => {});
  const after = sourceModel(editor);
  trackMention.mockReset();
  return { before, after };
}
