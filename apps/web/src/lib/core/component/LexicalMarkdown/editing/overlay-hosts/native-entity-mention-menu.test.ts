import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import type { EntityItem } from '@core/context/quickAccess';
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
import { createNativeUserMentionMenuHost } from './native-user-mention-menu';

const { trackMention } = vi.hoisted(() => ({ trackMention: vi.fn() }));
vi.mock('@core/signal/mention', () => ({ trackMention }));
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
      createNativeDocumentMentionViews(context)
    ),
    {
      namespace: 'entity-menu',
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
          'entity-menu'
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
const items: EntityItem[] = [
  {
    kind: 'entity',
    bucket: 'note',
    id: 'note-1',
    searchText: 'Reference',
    sortTimestamp: 0,
    timestamps: {},
    data: {
      type: 'document',
      id: 'note-1',
      name: 'Reference',
      ownerId: 'fixture-owner',
      fileType: 'md',
    },
  },
  {
    kind: 'entity',
    bucket: 'task',
    id: 'task-1',
    searchText: 'Task',
    sortTimestamp: 0,
    timestamps: {},
    data: {
      type: 'document',
      id: 'task-1',
      name: 'Task',
      ownerId: 'fixture-owner',
      fileType: 'md',
      subType: { type: 'task' },
    },
  },
  {
    kind: 'entity',
    bucket: 'channel',
    id: 'channel-1',
    searchText: 'Channel',
    sortTimestamp: 0,
    timestamps: {},
    data: {
      type: 'channel',
      id: 'channel-1',
      name: 'Channel',
      ownerId: 'fixture-owner',
      channelType: 'public',
    },
  },
  {
    kind: 'entity',
    bucket: 'dm',
    id: 'dm-1',
    searchText: 'Direct',
    sortTimestamp: 0,
    timestamps: {},
    data: {
      type: 'channel',
      id: 'dm-1',
      name: 'Direct',
      ownerId: 'fixture-owner',
      channelType: 'direct_message',
    },
  },
];
for (const item of items)
  test(`native ${item.bucket} choice removes search, tracks, inserts and renders actual Source static mention`, async () => {
    const runtime = mount();
    try {
      await runtime.host.select(item);
      expect(runtime.errors).toEqual([]);
      expect(trackMention).toHaveBeenCalledWith(
        'source-document',
        item.bucket === 'channel' || item.bucket === 'dm'
          ? 'channel'
          : 'document',
        item.id
      );
      expect(runtime.onDocumentMention).toHaveBeenCalledWith(item.data);
      expect(
        [...runtime.view.mirror.values()].filter(
          (node) => node.type === 'inline-search'
        )
      ).toHaveLength(0);
      const mentions = [...runtime.view.mirror.values()].filter(
        (node) => node.type === 'document-mention'
      );
      expect(mentions).toHaveLength(1);
      expect(mentions[0].props()).toMatchObject({
        documentId: item.id,
        documentName: item.data.name,
        mentionUuid: 'tracked-reference',
        blockName:
          item.bucket === 'note'
            ? 'md'
            : item.bucket === 'task'
              ? 'task'
              : 'channel',
      });
      expect(
        runtime.root.querySelector('[data-document-mention]')?.textContent
      ).toBe(item.data.name);
    } finally {
      await runtime.close();
    }
  });
for (const ending of ['ui-readonly', 'session-readonly', 'retired'] as const)
  test(`accepted tracking preserves distinct ${ending} authority`, async () => {
    const runtime = mount();
    const tracked = Promise.withResolvers<string>();
    const started = Promise.withResolvers<void>();
    trackMention.mockImplementation(() => {
      started.resolve();
      return tracked.promise;
    });
    try {
      const selected = runtime.host.select(items[0]);
      await started.promise;
      if (ending === 'ui-readonly') runtime.view.setEditable(false);
      else if (ending === 'session-readonly') runtime.authorize(false);
      else runtime.retire();
      tracked.resolve('tracked-reference');
      await selected;
      expect(runtime.errors).toEqual([]);
      expect(
        [...runtime.view.mirror.values()].filter(
          (node) => node.type === 'document-mention'
        )
      ).toHaveLength(ending === 'ui-readonly' ? 1 : 0);
    } finally {
      await runtime.close();
    }
  });

test('tracking uses the current model caret after ordinary edits without replaying the earlier browser range', async () => {
  const runtime = mount();
  const tracked = Promise.withResolvers<string>();
  const started = Promise.withResolvers<void>();
  trackMention.mockImplementation(() => {
    started.resolve();
    return tracked.promise;
  });
  try {
    const selected = runtime.host.select(items[0]);
    await started.promise;
    const generation = runtime.view.mirror.keyGeneration;
    const text = [...runtime.view.mirror.values()].find(
      (node) => node.kind === 'text' && node.text === 'body'
    );
    if (!text) throw new Error('Missing actual post-REMOVE text');
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: text.key, offset: 4, type: 'text' },
      focus: { key: text.key, offset: 4, type: 'text' },
    });
    runtime.port.command(CommandCode.InsertText, 0, 0, ' moved');
    expect(runtime.view.mirror.keyGeneration).toBe(generation);
    const element = runtime.view.getElementByKey(text.key);
    const domText = element?.firstChild;
    if (!domText || domText.nodeType !== Node.TEXT_NODE)
      throw new Error('Missing actual browser text');
    const range = document.createRange();
    range.setStart(domText, 0);
    range.collapse(true);
    const selection = document.getSelection();
    if (!selection) throw new Error('Missing actual browser selection');
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.anchorOffset).toBe(0);
    tracked.resolve('tracked-reference');
    await selected;
    expect(runtime.errors).toEqual([]);
    expect(runtime.root.textContent).toBe('body movedReference');
  } finally {
    await runtime.close();
  }
});

test('a same-generation state replacement during tracking retains current-selection insertion', async () => {
  const runtime = mount();
  const tracked = Promise.withResolvers<string>();
  const started = Promise.withResolvers<void>();
  trackMention.mockImplementation(() => {
    started.resolve();
    return tracked.promise;
  });
  try {
    const selected = runtime.host.select(items[0]);
    await started.promise;
    const generation = runtime.view.mirror.keyGeneration;
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'replacement' }],
            },
          ],
        },
      })
    );
    expect(runtime.view.mirror.keyGeneration).toBe(generation);
    tracked.resolve('tracked-reference');
    await selected;
    expect(runtime.errors).toEqual([]);
    expect(runtime.root.textContent).toBe('replacementReference');
    expect(
      [...runtime.view.mirror.values()].filter(
        (node) => node.type === 'document-mention'
      )
    ).toHaveLength(1);
  } finally {
    await runtime.close();
  }
});

for (const commandIndex of [1, 2])
  test(`queued owner retirement before command ${commandIndex} skips its real application entry`, async () => {
    const runtime = mount();
    const actual = runtime.port.inputSettledIfSessionEdit.bind(runtime.port);
    let calls = 0;
    const scheduling = vi
      .spyOn(runtime.port, 'inputSettledIfSessionEdit')
      .mockImplementation((...args) => {
        calls++;
        if (calls !== commandIndex) return actual(...args);
        let pending: ReturnType<typeof actual> | undefined;
        // Only scheduling is injected: the actual executor, authority call,
        // conditional entry, factory, producer and view remain real.
        runtime.executor.run(() => {
          const flags = runtime.executor.session.authorization(
            true,
            true,
            false,
            runtime.executor.now(),
            Date.now()
          );
          pending = actual(...args);
          runtime.retire();
          return flags;
        });
        if (!pending) throw new Error('Actual queued entry was not accepted');
        return pending;
      });
    try {
      await runtime.host.select(items[0]);
      expect(runtime.errors).toEqual([]);
      expect(
        [...runtime.view.mirror.values()].filter(
          (node) => node.type === 'document-mention'
        )
      ).toHaveLength(0);
      expect(
        [...runtime.view.mirror.values()].filter(
          (node) => node.type === 'inline-search'
        )
      ).toHaveLength(commandIndex === 1 ? 1 : 0);
      expect(trackMention).toHaveBeenCalledTimes(commandIndex === 1 ? 0 : 1);
    } finally {
      scheduling.mockRestore();
      await runtime.close();
    }
  });
