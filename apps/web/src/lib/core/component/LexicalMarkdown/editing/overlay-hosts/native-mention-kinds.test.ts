import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import { DocumentMentionNode } from '@macro-inc/lexical-core';
import { setDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { DocumentMention } from '../../component/decorator/DocumentMention';
import { createNativeDocumentMentionContext } from '../../decorator-host/native-document-mention-host';
import { createNativeDocumentMentionViews } from '../../decorator-host/native-document-mention-views';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import type { MentionItem } from '../../utils/mentionsUtils';
import { createNativeUserMentionMenuHost } from './native-user-mention-menu';

const { trackMention, publishRoutineTemplate } = vi.hoisted(() => ({
  trackMention: vi.fn(),
  publishRoutineTemplate: vi.fn(),
}));
vi.mock('@core/signal/mention', () => ({ trackMention }));
vi.mock('@app/features/routines/queries/templates', () => ({
  publishRoutineTemplate,
}));
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
  setDecorator(DocumentMentionNode, DocumentMention);
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
beforeEach(() => {
  trackMention.mockReset();
  trackMention.mockResolvedValue('tracked-reference');
  publishRoutineTemplate.mockReset();
  publishRoutineTemplate.mockResolvedValue(undefined);
});
function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const context = createNativeDocumentMentionContext(
    {},
    { isInteractable: () => true, skipPreviewFetch: true }
  );
  const errors: unknown[] = [];
  const runtime = mountLocalSessionView(
    root,
    registerMacroDecoratorViews(
      registerMacroElementViews(createBuiltinRegistry()),
      {
        ...createNativeDocumentMentionViews(context),
        // These cases check the model; the chips render through their own hosts.
        'group-mention': () => null,
        'agent-session-mention': () => null,
        'booking-link-mention': () => null,
      }
    ),
    {
      namespace: 'mention-kinds',
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
          'mention-kinds'
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
            children: [{ type: 'text', version: 1, text: 'body' }],
          },
        ],
      },
    })
  );
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!text) throw new Error('Missing actual native text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 0, type: 'text' },
    focus: { key: text.key, offset: 0, type: 'text' },
  });
  dispatchApplicationCommand(runtime.view, 'group-a.search-trigger', {
    kind: 'mentions',
  });
  runtime.port.command(CommandCode.InsertText, 0, 0, 'reference');
  expect(
    [...runtime.view.mirror.values()].some(
      (node) => node.type === 'inline-search'
    )
  ).toBe(true);
  let alive = true;
  const onDocumentMention = vi.fn();
  const host = createNativeUserMentionMenuHost(
    runtime.view,
    {
      sourceDocumentId: 'source-document',
      blockName: 'md',
      disableMentionTracking: false,
      onDocumentMention,
    },
    () => alive
  );
  return {
    ...runtime,
    root,
    errors,
    host,
    onDocumentMention,
    retire() {
      alive = false;
    },
    authorize(write: boolean) {
      runtime.executor.run(() =>
        runtime.executor.session.authorization(
          true,
          write,
          false,
          runtime.executor.now(),
          Date.now()
        )
      );
    },
    async close() {
      alive = false;
      context.dispose();
      await runtime.close();
      root.remove();
    },
  };
}

function inserted(runtime: ReturnType<typeof mount>, type: string) {
  expect(runtime.errors).toEqual([]);
  expect(
    [...runtime.view.mirror.values()].filter(
      (node) => node.type === 'inline-search'
    )
  ).toHaveLength(0);
  const nodes = [...runtime.view.mirror.values()].filter(
    (node) => node.type === type
  );
  expect(nodes).toHaveLength(1);
  return nodes[0].props();
}

test('native group choice inserts the Source group mention', async () => {
  const runtime = mount();
  try {
    const item: MentionItem = {
      kind: 'group',
      id: 'here',
      data: { id: 'here', groupAlias: 'here' },
    } as MentionItem;
    await runtime.host.select(item);
    expect(inserted(runtime, 'group-mention')).toMatchObject({
      groupAlias: 'here',
    });
  } finally {
    await runtime.close();
  }
});

test('native agent session choice tracks and inserts the Source agent chip', async () => {
  const runtime = mount();
  try {
    const item = {
      kind: 'agentSession',
      bucket: 'agent_session',
      id: 'session-1',
      searchText: 'Fix it',
      sortTimestamp: 0,
      timestamps: {},
      data: { type: 'agent_session', id: 'session-1', name: 'Fix it' },
    } as unknown as MentionItem;
    await runtime.host.select(item);
    expect(trackMention).toHaveBeenCalledWith(
      'source-document',
      'agent_session',
      'session-1'
    );
    expect(inserted(runtime, 'agent-session-mention')).toMatchObject({
      id: 'session-1',
      label: 'Fix it',
      mentionUuid: 'tracked-reference',
    });
  } finally {
    await runtime.close();
  }
});

test('native booking link choice inserts the Source booking mention', async () => {
  const runtime = mount();
  try {
    const item = {
      kind: 'bookingLink',
      id: 'booking-1',
      data: { profileId: 'p-1', slug: 'intro', title: 'Intro call' },
    } as unknown as MentionItem;
    await runtime.host.select(item);
    expect(inserted(runtime, 'booking-link-mention')).toMatchObject({
      profileId: 'p-1',
      slug: 'intro',
      label: 'Intro call',
      url: 'https://dev.macro.com/app/book/p-1/intro',
    });
  } finally {
    await runtime.close();
  }
});

test.each([
  [
    'calendar event',
    {
      kind: 'calendarEvent',
      id: 'event-1',
      data: { eventId: 'event-1', title: 'Standup', occurrenceKey: 'k-1' },
    },
    {
      documentId: 'event-1',
      documentName: 'Standup',
      blockName: 'calendar',
      blockParams: { occurrenceKey: 'k-1' },
    },
  ],
  [
    'external chat',
    {
      kind: 'externalChat',
      id: 'chat-1',
      data: { id: 'chat-1', name: 'Team' },
    },
    { documentId: 'chat-1', documentName: 'Team', blockName: 'external_chat' },
  ],
  [
    'routine',
    {
      kind: 'routine',
      id: 'routine-1',
      data: { id: 'routine-1', name: 'Daily' },
    },
    { documentId: 'routine-1', documentName: 'Daily', blockName: 'routine' },
  ],
  [
    'CRM contact',
    {
      kind: 'entity',
      bucket: 'crm_contact',
      id: 'contact-1',
      searchText: 'Ada',
      sortTimestamp: 0,
      timestamps: {},
      data: { type: 'crm_contact', id: 'contact-1', name: 'Ada' },
    },
    { documentId: 'contact-1', documentName: 'Ada', blockName: 'contact' },
  ],
] as const)(
  'native %s choice inserts the Source document mention',
  async (_label, item, props) => {
    const runtime = mount();
    try {
      await runtime.host.select(item as unknown as MentionItem);
      expect(inserted(runtime, 'document-mention')).toMatchObject(props);
    } finally {
      await runtime.close();
    }
  }
);
