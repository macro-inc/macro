import { $createListItemNode, $createListNode } from '@lexical/list';
import { $isDocumentMentionNode } from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  $canConvertCheckboxesToTasks,
  CONVERT_CHECKBOXES_TO_TASKS,
  checkboxToTaskPlugin,
  isCheckboxToTaskPluginEnabled,
} from '../plugins/checkbox-to-task/checkboxToTaskPlugin';
import type {
  ParsedCheckbox,
  TaskCreationResult,
} from '../plugins/checkbox-to-task/types';
import { behaviorEditor } from './editor';

const API = vi.hoisted(() => ({
  create:
    vi.fn<
      (
        checkbox: ParsedCheckbox,
        options: { currentUserId?: string; parentTaskId?: string }
      ) => Promise<string | null>
    >(),
}));
// Only task creation crosses the service boundary; parsing and replacement
// use the production plugin, real nodes, selection and Markdown exporter.
vi.mock('@core/util/taskCreation', () => ({ createTaskFromData: API.create }));
beforeEach(() => {
  API.create.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function addCheckboxes(
  editor: LexicalEditor,
  titles: string[],
  checked = false
) {
  const keys: string[] = [];
  editor.update(
    () => {
      const list = $createListNode('check');
      const textNodes = titles.map((title) => $createTextNode(title));
      for (const text of textNodes) {
        const item = $createListItemNode(checked).append(text);
        keys.push(item.getKey());
        list.append(item);
      }
      $getRoot().clear().append(list);
      const selection = textNodes[0].select(0, 0);
      const last = textNodes[textNodes.length - 1];
      selection.focus.set(last.getKey(), last.getTextContentSize(), 'text');
    },
    { discrete: true }
  );
  return keys;
}
function mentions(editor: LexicalEditor) {
  return editor.read(() => {
    const queue = [...$getRoot().getChildren()];
    const found: { id: string; name: string; block: string }[] = [];
    while (queue.length) {
      const node = queue.shift()!;
      if ($isDocumentMentionNode(node))
        found.push({
          id: node.getDocumentId(),
          name: node.getDocumentName(),
          block: node.getBlockName(),
        });
      else if ($isElementNode(node)) queue.unshift(...node.getChildren());
    }
    return found;
  });
}

describe('checkbox task conversion', () => {
  it.each(['null', 'node'] as const)(
    'yields a %s selection without service calls or completion',
    (kind) => {
      const { editor } = behaviorEditor(checkboxToTaskPlugin());
      const complete = vi.fn();
      editor.update(
        () => {
          const paragraph = $createParagraphNode().append(
            $createTextNode('plain')
          );
          $getRoot().append(paragraph);
          if (kind === 'node') {
            const selected = $createNodeSelection();
            selected.add(paragraph.getKey());
            $setSelection(selected);
          } else $setSelection(null);
          expect($canConvertCheckboxesToTasks()).toBe(false);
          expect(
            editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {
              onComplete: complete,
            })
          ).toBe(false);
        },
        { discrete: true }
      );
      expect(API.create).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    }
  );

  it.each(['paragraph', 'bullet'] as const)(
    'completes an empty checkbox scan in a %s without mutation',
    (kind) => {
      const { editor } = behaviorEditor(checkboxToTaskPlugin());
      const complete = vi.fn();
      editor.update(
        () => {
          const text = $createTextNode('plain');
          const block =
            kind === 'bullet'
              ? $createListNode('bullet').append(
                  $createListItemNode().append(text)
                )
              : $createParagraphNode().append(text);
          $getRoot().append(block);
          text.select(0, 5);
          expect($canConvertCheckboxesToTasks()).toBe(false);
          expect(
            editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {
              onComplete: complete,
            })
          ).toBe(false);
        },
        { discrete: true }
      );
      expect(complete).toHaveBeenCalledExactlyOnceWith([]);
      expect(API.create).not.toHaveBeenCalled();
      expect(editor.read(() => $getRoot().getTextContent())).toBe('plain');
    }
  );

  it('registration cleanup removes conversion availability and command handling', () => {
    const { editor } = behaviorEditor();
    expect(isCheckboxToTaskPluginEnabled(editor)).toBe(false);
    const release = checkboxToTaskPlugin()(editor);
    expect(isCheckboxToTaskPluginEnabled(editor)).toBe(true);
    release();
    expect(isCheckboxToTaskPluginEnabled(editor)).toBe(false);
    expect(editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {})).toBe(false);
  });

  it.each([true, false])(
    'converts a checked=%s item with parsed title and plugin options',
    async (checked) => {
      API.create.mockResolvedValue('fixture-task');
      const { editor } = behaviorEditor(
        checkboxToTaskPlugin({
          currentUserId: 'fixture-user',
          parentTaskId: 'fixture-parent',
        })
      );
      const [key] = addCheckboxes(editor, ['  First   task  '], checked);
      const complete = deferred<TaskCreationResult[]>();
      editor.update(
        () => {
          expect($canConvertCheckboxesToTasks()).toBe(true);
          expect(
            editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {
              onComplete: complete.resolve,
            })
          ).toBe(true);
        },
        { discrete: true }
      );
      const results = await complete.promise;
      expect(API.create).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          nodeKey: key,
          title: 'First task',
          assigneeUserIds: [],
          dueDate: null,
          rawMarkdown: expect.stringContaining('First'),
        }),
        { currentUserId: 'fixture-user', parentTaskId: 'fixture-parent' }
      );
      expect(results).toHaveLength(1);
      expect(results[0].isOk()).toBe(true);
      expect(mentions(editor)).toEqual([
        { id: 'fixture-task', name: 'First task', block: 'task' },
      ]);
      expect(editor.read(() => $getNodeByKey(key))).toBeNull();
    }
  );

  it('honors an explicitly stored range after the current caret moves elsewhere', async () => {
    API.create.mockResolvedValue('fixture-task');
    const { editor } = behaviorEditor(checkboxToTaskPlugin());
    addCheckboxes(editor, ['selected task']);
    let stored!: RangeSelection;
    editor.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error('Expected range');
        stored = selection.clone();
        const other = $createTextNode('other');
        $getRoot().append($createParagraphNode().append(other));
        other.select(0, 5);
        expect($canConvertCheckboxesToTasks()).toBe(false);
      },
      { discrete: true }
    );
    const complete = deferred<TaskCreationResult[]>();
    editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {
      selection: stored,
      onComplete: complete.resolve,
    });
    await complete.promise;
    expect(mentions(editor)).toEqual([
      { id: 'fixture-task', name: 'selected task', block: 'task' },
    ]);
    expect(editor.read(() => $getRoot().getLastChild()?.getTextContent())).toBe(
      'other'
    );
  });

  it('starts all creations before completion and replaces successful items in one update', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    API.create
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { editor } = behaviorEditor(checkboxToTaskPlugin());
    const keys = addCheckboxes(editor, ['first', 'second']);
    const complete = deferred<TaskCreationResult[]>();
    editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {
      onComplete: complete.resolve,
    });
    expect(API.create).toHaveBeenCalledTimes(2);
    expect(mentions(editor)).toEqual([]);
    first.resolve('first-task');
    await first.promise;
    expect(mentions(editor)).toEqual([]);
    expect(
      editor.read(() => keys.every((key) => $getNodeByKey(key)?.isAttached()))
    ).toBe(true);
    const updates = vi.fn();
    const release = editor.registerUpdateListener(updates);
    second.resolve('second-task');
    const results = await complete.promise;
    release();
    expect(results.map((result) => result.isOk())).toEqual([true, true]);
    expect(updates).toHaveBeenCalledOnce();
    expect(mentions(editor)).toEqual([
      { id: 'first-task', name: 'first', block: 'task' },
      { id: 'second-task', name: 'second', block: 'task' },
    ]);
  });

  it('reports empty and rejected creations while preserving failed checkbox nodes', async () => {
    API.create
      .mockResolvedValueOnce('created-task')
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('request failed'))
      .mockRejectedValueOnce('offline');
    const { editor } = behaviorEditor(checkboxToTaskPlugin());
    const keys = addCheckboxes(editor, [
      'success',
      'empty',
      'error',
      'unknown',
    ]);
    const complete = deferred<TaskCreationResult[]>();
    editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {
      onComplete: complete.resolve,
    });
    const results = await complete.promise;
    expect(
      results.map((result) => (result.isOk() ? 'ok' : result.error))
    ).toEqual([
      'ok',
      { tag: 'EmptyCheckbox', nodeKey: keys[1] },
      { tag: 'ApiError', nodeKey: keys[2], message: 'request failed' },
      { tag: 'ApiError', nodeKey: keys[3], message: 'Unknown error' },
    ]);
    expect(mentions(editor)).toEqual([
      { id: 'created-task', name: 'success', block: 'task' },
    ]);
    editor.read(() => {
      expect($getNodeByKey(keys[0])).toBeNull();
      expect(
        keys.slice(1).map((key) => $getNodeByKey(key)?.getTextContent())
      ).toEqual(['empty', 'error', 'unknown']);
    });
  });

  it('does not resurrect a checkbox deleted before its creation result arrives', async () => {
    const response = deferred<string | null>();
    API.create.mockImplementation(() => response.promise);
    const { editor } = behaviorEditor(checkboxToTaskPlugin());
    const [key] = addCheckboxes(editor, ['deleted']);
    const complete = deferred<TaskCreationResult[]>();
    editor.dispatchCommand(CONVERT_CHECKBOXES_TO_TASKS, {
      onComplete: complete.resolve,
    });
    editor.update(
      () => {
        $getNodeByKey(key)?.remove();
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode('retained')));
      },
      { discrete: true }
    );
    response.resolve('created-task');
    const results = await complete.promise;
    expect(results[0].isOk()).toBe(true);
    expect(mentions(editor)).toEqual([]);
    expect(editor.read(() => $getRoot().getTextContent())).toBe('retained');
  });
});
