import {
  $createListItemNode,
  $createListNode,
  type ListItemNode,
  type ListNode,
} from '@lexical/list';
import {
  $createDateMentionNode,
  $createDocumentMentionNode,
  $createUserMentionNode,
} from '@macro-inc/lexical-core';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $collectChecklistMeta } from '../plugins/checklist-controls/collect';
import { behaviorEditor } from './editor';

describe('checklist node collection', () => {
  it('collects only root checklists and excludes nested rows from progress', () => {
    const { editor } = behaviorEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('bullet').append(
            $createListItemNode().append($createTextNode('Bullet'))
          ),
          $createParagraphNode(),
          $createListNode('number').append(
            $createListItemNode().append($createTextNode('Number'))
          ),
          $createParagraphNode(),
          $createListNode('check').append(
            $createListItemNode(true).append($createTextNode('Parent')),
            $createListItemNode().append(
              $createListNode('check').append(
                $createListItemNode(false).append($createTextNode('Nested'))
              )
            )
          )
        );
      },
      { discrete: true }
    );
    const lists = Object.values(editor.read($collectChecklistMeta));
    expect(lists).toHaveLength(1);
    expect(lists[0].items).toHaveLength(1);
    expect(lists[0].items[0]).toMatchObject({ text: 'Parent', checked: true });
    expect(lists[0].items[0].attachedKeys).toHaveLength(1);
  });

  it('deduplicates assignees by id in document order and keeps the first display name', () => {
    const { editor } = behaviorEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('check').append(
            $createListItemNode(false).append(
              $createUserMentionNode({
                userId: 'person-a',
                email: 'a@example.com',
                displayName: 'First label',
              }),
              $createTextNode(' '),
              $createUserMentionNode({
                userId: 'person-b',
                email: 'b@example.com',
                displayName: 'Second label',
              }),
              $createTextNode(' '),
              $createUserMentionNode({
                userId: 'person-a',
                email: 'a@example.com',
                displayName: 'Changed label',
              })
            )
          )
        );
      },
      { discrete: true }
    );
    const [list] = Object.values(editor.read($collectChecklistMeta));
    expect(list.items[0].mentionAssignees).toEqual([
      { id: 'person-a', name: 'First label' },
      { id: 'person-b', name: 'Second label' },
    ]);
  });

  it('takes the first date and task mention while ignoring other document kinds', () => {
    const { editor } = behaviorEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('check').append(
            $createListItemNode(false).append(
              $createDocumentMentionNode({
                documentId: 'ordinary',
                documentName: 'Document',
                blockName: 'md',
              }),
              $createDateMentionNode({
                date: '2030-05-14',
                displayFormat: 'yyyy-MM-dd',
              }),
              $createDateMentionNode({
                date: '2030-05-15',
                displayFormat: 'yyyy-MM-dd',
              }),
              $createDocumentMentionNode({
                documentId: 'first-task',
                documentName: 'First',
                blockName: 'task',
              }),
              $createDocumentMentionNode({
                documentId: 'second-task',
                documentName: 'Second',
                blockName: 'task',
              })
            )
          )
        );
      },
      { discrete: true }
    );
    const [list] = Object.values(editor.read($collectChecklistMeta));
    expect(list.items[0]).toMatchObject({
      mentionDue: '2030-05-14',
      taskId: 'first-task',
    });
  });

  it('assigns leading and trailing nested wrappers to the adjacent ordinary row', () => {
    const { editor } = behaviorEditor();
    const keys: string[] = [];
    editor.update(
      () => {
        const leading = $createListItemNode().append(
          $createListNode('bullet').append(
            $createListItemNode().append($createTextNode('Leading nested'))
          )
        );
        const row = $createListItemNode(false).append($createTextNode('Work'));
        const trailing = $createListItemNode().append(
          $createListNode('number').append(
            $createListItemNode().append($createTextNode('Trailing nested'))
          )
        );
        keys.push(leading.getKey(), row.getKey(), trailing.getKey());
        $getRoot().append(
          $createListNode('check').append(leading, row, trailing)
        );
      },
      { discrete: true }
    );
    const [list] = Object.values(editor.read($collectChecklistMeta));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      key: keys[1],
      leadingKeys: [keys[0]],
      attachedKeys: [keys[2]],
      text: 'Work',
    });
  });

  it('recomputes trimmed text priority and clears removed inline metadata after committed edits', () => {
    const { editor } = behaviorEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createListNode('check').append(
            $createListItemNode(true).append(
              $createUserMentionNode({
                userId: 'person',
                email: 'person@example.com',
                displayName: 'Person',
              }),
              $createDateMentionNode({
                date: '2030-05-14',
                displayFormat: 'yyyy-MM-dd',
              }),
              $createTextNode(' Work!!  ')
            )
          )
        );
      },
      { discrete: true }
    );
    const [before] = Object.values(editor.read($collectChecklistMeta));
    expect(before.items[0]).toMatchObject({
      markerPriority: 'high',
      checked: true,
      mentionDue: '2030-05-14',
    });
    expect(before.items[0].mentionAssignees).toHaveLength(1);
    editor.update(
      () => {
        const list = $getRoot().getFirstChildOrThrow<ListNode>();
        const row = list.getFirstChildOrThrow<ListItemNode>();
        row.clear().append($createTextNode('  Changed!  '));
      },
      { discrete: true }
    );
    const [after] = Object.values(editor.read($collectChecklistMeta));
    expect(after.items[0]).toMatchObject({
      text: 'Changed!',
      markerPriority: 'medium',
      checked: true,
      mentionDue: null,
      mentionAssignees: [],
    });
  });
});
