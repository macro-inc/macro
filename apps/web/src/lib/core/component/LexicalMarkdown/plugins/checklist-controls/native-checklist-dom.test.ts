// @vitest-environment jsdom
import { $createListItemNode, ListItemNode, ListNode } from '@lexical/list';
import { TaskListNode } from '@macro-inc/lexical-core';
import {
  $createTextNode,
  $getRoot,
  createEditor,
  type TextNode,
} from 'lexical';
import { beforeAll, expect, test } from 'vitest';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../../../../../../../../../packages/lexical-wasm-view/src/view/test/native-surface';
import { checklistPlugin } from '../checklist/checklistPlugin';
import { registerNativeChecklist } from '../checklist/native';
import { dispatchApplicationCommand } from '../group-b/command';

beforeAll(initializeNativeSurfaceTests);

test('checklist DOM follows actual Source after a descendant-only edit and an own toggle', () => {
  const theme = { list: { ul: 'source-list', checklist: 'md-check' } };
  const source = createEditor({
    namespace: 'source-checklist-dom',
    theme,
    nodes: [ListNode, ListItemNode, TaskListNode],
    onError(error) {
      throw error;
    },
  });
  const sourceRoot = document.createElement('div');
  document.body.append(sourceRoot);
  source.setRootElement(sourceRoot);
  const cleanupSource = checklistPlugin()(source);
  const native = nativeSurface(undefined, theme);
  const cleanupNative = registerNativeChecklist(native.view);
  let text: TextNode | undefined;
  let item: ListItemNode | undefined;
  try {
    source.update(
      () => {
        const list = new TaskListNode('check');
        text = $createTextNode('task apple');
        item = $createListItemNode(false);
        list.append(item.append(text));
        $getRoot().append(list);
      },
      { discrete: true }
    );
    native.port.setState(JSON.stringify(source.getEditorState().toJSON()));
    const sourceList = sourceRoot.querySelector('ul');
    const nativeList = native.root.querySelector('ul');
    const sourceItem = sourceRoot.querySelector('li');
    const nativeItem = native.root.querySelector('li');
    if (!sourceList || !nativeList || !sourceItem || !nativeItem || !text)
      throw new Error('Missing actual checklist DOM');
    expect(nativeList.className).toBe(sourceList.className);
    expect(nativeList.classList.contains('md-check')).toBe(true);
    expect(nativeItem.getAttribute('tabindex')).toBe(
      sourceItem.getAttribute('tabindex')
    );
    expect(sourceItem.hasAttribute('tabindex')).toBe(false);
    const actualText = text;
    source.update(() => actualText.setTextContent('task pear'), {
      discrete: true,
    });
    const nativeText = [...native.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!nativeText) throw new Error('Missing actual native checklist text');
    native.port.textFromView({
      key: nativeText.key,
      text: 'task pear',
      anchorOffset: 9,
      focusOffset: 9,
    });
    expect(sourceItem.textContent).toBe('task pear');
    expect(nativeItem.textContent).toBe(sourceItem.textContent);
    expect(sourceItem.getAttribute('tabindex')).toBe('-1');
    expect(nativeItem.getAttribute('tabindex')).toBe(
      sourceItem.getAttribute('tabindex')
    );
    if (!item) throw new Error('Missing Source checklist item');
    const actualItem = item;
    source.update(() => actualItem.toggleChecked(), { discrete: true });
    const nativeListItem = [...native.view.mirror.values()].find(
      (node) => node.type === 'listitem'
    );
    if (!nativeListItem) throw new Error('Missing native checklist item');
    dispatchApplicationCommand(native.view, 'group-b.checklist', {
      action: 'toggle',
      key: nativeListItem.key,
    });
    expect(sourceItem.getAttribute('aria-checked')).toBe('true');
    expect(nativeItem.getAttribute('aria-checked')).toBe(
      sourceItem.getAttribute('aria-checked')
    );
    expect(sourceItem.hasAttribute('tabindex')).toBe(false);
    expect(nativeItem.hasAttribute('tabindex')).toBe(false);
  } finally {
    cleanupNative();
    native.close();
    cleanupSource();
    source.setRootElement(null);
    sourceRoot.remove();
  }
});
