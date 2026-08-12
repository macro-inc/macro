import { $createListItemNode, $createListNode } from '@lexical/list';
import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import { $createTextNode, $getRoot, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $getProgressStats } from './progressPlugin';

function $checkbox(text: string, checked: boolean) {
  const item = $createListItemNode(checked);
  item.append($createTextNode(text));
  return item;
}

function $bullet(text: string) {
  const item = $createListItemNode();
  item.append($createTextNode(text));
  return item;
}

describe('$getProgressStats', () => {
  it('counts checked and unchecked leaf checklist items', () => {
    const editor = createEditor({
      namespace: 'progress-plugin-test',
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });

    editor.update(
      () => {
        const checklist = $createListNode('check');
        const parent = $checkbox('group', true);
        const childList = $createListNode('check');
        childList.append($checkbox('nested todo', false));
        parent.append(childList);

        checklist.append(
          $checkbox('done', true),
          $checkbox('todo', false),
          $checkbox('also done', true),
          $checkbox('   ', true),
          parent
        );

        const bullets = $createListNode('bullet');
        bullets.append($bullet('not counted'));

        const nestedChecklist = $createListNode('check');
        nestedChecklist.append($checkbox('structural nested todo', false));
        const wrapper = $createListItemNode();
        wrapper.append(nestedChecklist);
        checklist.append(wrapper);

        $getRoot().clear().append(checklist, bullets);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      expect($getProgressStats()).toEqual({
        completed: 2,
        total: 5,
      });
    });
  });
});
