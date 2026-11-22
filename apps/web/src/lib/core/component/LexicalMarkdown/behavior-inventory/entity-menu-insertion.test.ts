import { writeFileSync } from 'node:fs';
import type { EntityItem } from '@core/context/quickAccess';
import { DocumentMentionNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
} from 'lexical';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createItemHandler } from '../component/menu/MentionsMenu/utils/mentionHandlers';
import { mentionsPlugin } from '../plugins/mentions/mentionsPlugin';
import { behaviorEditor } from './editor';

const { trackMention } = vi.hoisted(() => ({ trackMention: vi.fn() }));
vi.mock('@core/signal/mention', () => ({ trackMention }));
vi.hoisted(() => {
  vi.stubGlobal(
    'WebSocket',
    class {
      readyState = 1;
      close() {}
      addEventListener() {}
      removeEventListener() {}
      send() {}
    }
  );
});
const captures: unknown[] = [];
afterEach(() => {
  if (process.env.ENTITY_MENU_SOURCE_CAPTURE)
    writeFileSync(
      process.env.ENTITY_MENU_SOURCE_CAPTURE,
      JSON.stringify(captures, null, 2)
    );
  vi.restoreAllMocks();
});
beforeEach(() => {
  trackMention.mockReset();
  trackMention.mockResolvedValue('tracked-reference');
  vi.spyOn(Date, 'now').mockReturnValue(123456789);
});
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
function fixture() {
  const actual = behaviorEditor(mentionsPlugin({}));
  actual.editor.update(
    () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('body')))
        .selectEnd();
    },
    { discrete: true }
  );
  return actual;
}
function snapshot(editor: ReturnType<typeof fixture>['editor']) {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    return {
      json: editor.getEditorState().toJSON(),
      text: $getRoot().getTextContent(),
      mentions: $nodesOfType(DocumentMentionNode).map((node) =>
        node.exportJSON()
      ),
      selection: $isRangeSelection(selection)
        ? {
            anchorOffset: selection.anchor.offset,
            anchorType: selection.anchor.type,
            focusOffset: selection.focus.offset,
            focusType: selection.focus.type,
          }
        : null,
    };
  });
}
for (const item of items)
  test(`actual Source ${item.bucket} tracks then inserts into current model`, async () => {
    const { editor } = fixture();
    const onDocumentMention = vi.fn();
    await createItemHandler({
      editor,
      blockId: 'source-document',
      blockName: 'md',
      onDocumentMention,
    })(item);
    editor.read(() => {});
    const result = snapshot(editor);
    expect(trackMention).toHaveBeenCalledWith(
      'source-document',
      item.bucket === 'channel' || item.bucket === 'dm'
        ? 'channel'
        : 'document',
      item.id
    );
    expect(onDocumentMention).toHaveBeenCalledWith(item.data);
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      documentId: item.id,
      documentName: item.data.name,
      blockName:
        item.bucket === 'note'
          ? 'md'
          : item.bucket === 'task'
            ? 'task'
            : 'channel',
      mentionUuid: 'tracked-reference',
    });
    if (item.data.type === 'channel')
      expect(result.mentions[0]).toMatchObject({
        channelType: item.data.channelType,
      });
    captures.push({ name: item.bucket, result });
  });
test('dispatch callee resolves before entity payload getters', async () => {
  const { editor } = fixture();
  const events: string[] = [];
  const base = items[2];
  const item: EntityItem = {
    ...base,
    data: {
      ...base.data,
      get id() {
        events.push('payload-id');
        return 'channel-1';
      },
    },
  };
  const dispatch = editor.dispatchCommand.bind(editor);
  Object.defineProperty(editor, 'dispatchCommand', {
    configurable: true,
    get() {
      events.push('dispatch-callee');
      return dispatch;
    },
  });
  await createItemHandler({ editor, disableMentionTracking: true })(item);
  editor.read(() => {});
  expect(events).toEqual(['dispatch-callee', 'dispatch-callee', 'payload-id']);
  captures.push({ name: 'callee-order', events, result: snapshot(editor) });
});
for (const failure of [undefined, null, { opaque: true }])
  test(`opaque ${String(failure)} attachment rejection prevents insert`, async () => {
    const { editor } = fixture();
    const observed: { threw: boolean; error?: unknown } = { threw: false };
    try {
      await createItemHandler({
        editor,
        blockId: 'source-document',
        onDocumentMention() {
          throw failure;
        },
      })(items[0]);
    } catch (error) {
      observed.threw = true;
      observed.error = error;
    }
    editor.read(() => {});
    expect(observed).toEqual({ threw: true, error: failure });
    expect(snapshot(editor).mentions).toEqual([]);
    captures.push({
      name: `opaque-${String(failure)}`,
      observed,
      result: snapshot(editor),
    });
  });
test('accepted tracking inserts after UI-only readonly transition', async () => {
  const { editor } = fixture();
  const tracked = Promise.withResolvers<string>();
  trackMention.mockReturnValue(tracked.promise);
  const pending = createItemHandler({
    editor,
    blockId: 'source-document',
    blockName: 'md',
  })(items[1]);
  expect(trackMention).toHaveBeenCalledTimes(1);
  editor.setEditable(false);
  tracked.resolve('tracked-reference');
  await pending;
  editor.read(() => {});
  expect(editor.isEditable()).toBe(false);
  expect(snapshot(editor).mentions[0]).toMatchObject({
    documentId: 'task-1',
    mentionUuid: 'tracked-reference',
  });
  captures.push({ name: 'accepted-ui-readonly', result: snapshot(editor) });
});
test('tracking rejection prevents insertion and attachment', async () => {
  const { editor } = fixture();
  const failure = { tracking: true };
  trackMention.mockRejectedValue(failure);
  const onDocumentMention = vi.fn();
  await expect(
    createItemHandler({
      editor,
      blockId: 'source-document',
      onDocumentMention,
    })(items[0])
  ).rejects.toBe(failure);
  expect(onDocumentMention).not.toHaveBeenCalled();
  editor.read(() => {});
  expect(snapshot(editor).mentions).toEqual([]);
  captures.push({ name: 'tracking-rejection', result: snapshot(editor) });
});

test('actual Source uses the model caret after an ordinary edit during tracking', async () => {
  const { editor } = fixture();
  const tracked = Promise.withResolvers<string>();
  trackMention.mockReturnValue(tracked.promise);
  const pending = createItemHandler({
    editor,
    blockId: 'source-document',
    blockName: 'md',
  })(items[0]);
  expect(trackMention).toHaveBeenCalledTimes(1);
  editor.update(
    () => {
      $getRoot().selectEnd().insertText(' moved');
    },
    { discrete: true }
  );
  tracked.resolve('tracked-reference');
  await pending;
  editor.read(() => {});
  expect(snapshot(editor).text).toBe('body movedReference');
  captures.push({ name: 'current-caret-after-edit', result: snapshot(editor) });
});

for (const failure of [undefined, null, { preparation: true }])
  test(`actual Source preparation preserves opaque ${String(failure)} asynchronous rejection`, async () => {
    const { editor } = fixture();
    let editorReads = 0;
    const dependencies = {
      get editor() {
        editorReads++;
        if (editorReads === 2) throw failure;
        return editor;
      },
      blockId: 'source-document',
    };
    const observed: { threw: boolean; error?: unknown } = { threw: false };
    let synchronousThrow = false;
    let pending: Promise<void> | undefined;
    try {
      pending = createItemHandler(dependencies)(items[0]);
    } catch {
      synchronousThrow = true;
    }
    expect(synchronousThrow).toBe(false);
    expect(pending).toBeInstanceOf(Promise);
    try {
      await pending;
    } catch (error) {
      observed.threw = true;
      observed.error = error;
    }
    expect(observed).toEqual({ threw: true, error: failure });
    expect(editorReads).toBe(2);
    expect(trackMention).not.toHaveBeenCalled();
    editor.read(() => {});
    expect(snapshot(editor).mentions).toEqual([]);
    captures.push({
      name: `prepare-${String(failure)}`,
      observed,
      result: snapshot(editor),
    });
  });
