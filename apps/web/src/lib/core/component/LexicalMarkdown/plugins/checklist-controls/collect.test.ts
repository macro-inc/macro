import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list';
import {
  $createDocumentMentionNode,
  $setTaskListViewSettings,
  DocumentMentionNode,
} from '@macro-inc/lexical-core';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { $collectChecklistMeta } from './collect';
import { effectiveItem, normalizeSettings, planChecklist } from './model';

function makeEditor() {
  return createEditor({
    nodes: [ListNode, ListItemNode, DocumentMentionNode],
    onError: (error) => {
      throw error;
    },
  });
}

describe('task-list controls', () => {
  it('collects every checklist, but only task mentions make items tasks', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const list = $createListNode('check').append(
          $createListItemNode(true).append(
            $createTextNode('Plain checkbox !!!')
          ),
          $createListItemNode(false).append(
            $createDocumentMentionNode({
              documentId: 'document-id',
              documentName: 'Document',
              blockName: 'md',
            })
          )
        );
        $setTaskListViewSettings(list, { filters: { status: ['done'] } });
        $getRoot().append(
          list,
          $createParagraphNode(),
          $createListNode('check').append(
            $createListItemNode(false).append($createTextNode('Another list'))
          )
        );
      },
      { discrete: true }
    );

    const lists = Object.values(editor.read($collectChecklistMeta));
    expect(lists).toHaveLength(2);
    // A plain document mention is not a task, so no item qualifies the list
    // for the filter control.
    expect(
      lists.every((meta) => meta.items.every((item) => item.taskId === null))
    ).toBe(true);
    expect(lists[0].settings).toEqual({ filters: { status: ['done'] } });
  });

  it('marks only items that mention a task', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('check').append(
            $createListItemNode(false).append($createTextNode('Ordinary list'))
          ),
          $createParagraphNode(),
          $createListNode('check').append(
            $createListItemNode(false).append($createTextNode('Plain item')),
            $createListItemNode(false).append(
              $createDocumentMentionNode({
                documentId: 'task-id',
                documentName: 'Task',
                blockName: 'task',
              })
            )
          )
        );
      },
      { discrete: true }
    );

    const lists = Object.values(editor.read($collectChecklistMeta));
    expect(lists).toHaveLength(2);
    const taskIds = lists.map((meta) => meta.items.map((item) => item.taskId));
    expect(taskIds).toContainEqual([null]);
    expect(taskIds).toContainEqual([null, 'task-id']);
  });

  it('drops the task marker when the mention is replaced with plain text', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('check').append(
            $createListItemNode(false).append(
              $createDocumentMentionNode({
                documentId: 'task-id',
                documentName: 'Task',
                blockName: 'task',
              })
            )
          )
        );
      },
      { discrete: true }
    );
    const before = Object.values(editor.read($collectChecklistMeta));
    expect(before[0].items.map((item) => item.taskId)).toEqual(['task-id']);

    editor.update(
      () => {
        const list = $getRoot().getFirstChildOrThrow<ListNode>();
        list
          .getFirstChildOrThrow<ListItemNode>()
          .clear()
          .append($createTextNode('Plain item'));
      },
      { discrete: true }
    );

    const after = Object.values(editor.read($collectChecklistMeta));
    expect(after).toHaveLength(1);
    expect(after[0].items.map((item) => item.taskId)).toEqual([null]);
  });

  it('counts a ticked checkbox as done even when its task status lags', () => {
    const base = {
      leadingKeys: [],
      attachedKeys: [],
      mentionAssignees: [],
      mentionDue: null,
      markerPriority: null,
      taskId: 'task-id',
    };
    const notStartedTask = {
      statusOptionId: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
      priorityOptionId: null,
      assigneeIds: [],
      due: null,
    };
    const items = [
      effectiveItem(
        { ...base, key: 'ticked', checked: true, text: 'Ticked' },
        notStartedTask,
        (id) => id
      ),
      effectiveItem(
        { ...base, key: 'open', checked: false, text: 'Open' },
        notStartedTask,
        (id) => id
      ),
      effectiveItem(
        {
          ...base,
          key: 'closed',
          checked: false,
          text: 'Closed in tasks view',
        },
        {
          ...notStartedTask,
          statusOptionId: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
        },
        (id) => id
      ),
    ];

    const plan = planChecklist(items, normalizeSettings(null), new Date());
    expect(plan.progress).toEqual({ done: 2, total: 3 });
  });

  it('dims filtered items even when an older saved setting requests hiding them', () => {
    // `hideFiltered` was written by an older build; hiding was removed.
    const legacySettings = {
      filters: { status: ['done'] },
      hideFiltered: true,
    };
    const settings = normalizeSettings(legacySettings);
    const item = effectiveItem(
      {
        key: 'item',
        leadingKeys: [],
        attachedKeys: [],
        checked: false,
        text: 'Task',
        mentionAssignees: [],
        mentionDue: null,
        markerPriority: null,
        taskId: 'task-id',
      },
      undefined,
      (id) => id
    );

    expect(planChecklist([item], settings, new Date()).rows).toEqual([
      { key: 'item', dimmed: true },
    ]);
  });
});
