// @vitest-environment jsdom
import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
} from '@lexical/list';
import { textLeaf } from '@macro-inc/lexical-wasm-view/view/dom';
import { $createTextNode, $getNodeByKey, $getRoot, $isTextNode } from 'lexical';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { behaviorEditor } from '../../behavior-inventory/editor';
import {
  initializeNativeKeyboardSurface,
  nativeAcknowledgementSurface,
} from '../../editing/test/native-keyboard-surface';
import { checklistPlugin } from './checklistPlugin';
import { registerNativeChecklist } from './native';

beforeAll(() => initializeNativeKeyboardSurface());
afterEach(() => vi.restoreAllMocks());

for (const entry of [
  { checked: false, nested: false },
  { checked: true, nested: false },
  { checked: false, nested: true },
]) {
  test(`accepted text echo refreshes Source checklist ancestor attributes (${JSON.stringify(entry)})`, async () => {
    const source = behaviorEditor(checklistPlugin());
    let textKey = '';
    source.editor.update(
      () => {
        const text = $createTextNode('todo');
        textKey = text.getKey();
        const list = $createListNode('check').append(
          $createListItemNode(entry.checked).append(text)
        );
        $getRoot().append(
          entry.nested
            ? $createListNode('check').append(
                $createListItemNode().append(list)
              )
            : list
        );
      },
      { discrete: true }
    );
    const initial = source.editor.getEditorState().toJSON();
    const sourceItem = source.root.querySelector('li[role="checkbox"]');
    if (!(sourceItem instanceof HTMLElement))
      throw new Error('Missing Source checklist leaf');
    expect(sourceItem.hasAttribute('tabindex')).toBe(false);
    const sourceMutations: string[] = [];
    const offSource = source.editor.registerMutationListener(
      ListItemNode,
      (changes) => sourceMutations.push(...changes.values()),
      { skipInitialization: true }
    );
    source.editor.update(
      () => {
        const text = $getNodeByKey(textKey);
        if (!$isTextNode(text)) throw new Error('Missing Source text');
        text.setTextContent('todo1. ');
      },
      { discrete: true }
    );
    offSource();
    expect(sourceMutations).toEqual([]);
    expect(sourceItem.getAttribute('tabindex')).toBe('-1');

    const fixture = await nativeAcknowledgementSurface();
    let cleanup = () => {};
    try {
      fixture.port.setState(JSON.stringify(initial));
      const node = [...fixture.view.mirror.values()].find(
        (node) => node.kind === 'text' && node.text === 'todo'
      );
      if (!node) throw new Error('Missing actual native text');
      const element = fixture.view.getElementByKey(node.key);
      const leaf = element ? textLeaf(element) : null;
      if (!leaf) throw new Error('Missing actual native text DOM');
      // Establish real view ownership/selection before the measured echo.
      for (const text of ['todoa', 'todo'])
        fixture.port.textFromView({
          key: node.key,
          text,
          anchorOffset: text.length,
          focusOffset: text.length,
        });
      cleanup = registerNativeChecklist(fixture.view);
      const item = fixture.root.querySelector('li[role="checkbox"]');
      if (!(item instanceof HTMLElement))
        throw new Error('Missing native checklist leaf');
      expect(item.hasAttribute('tabindex')).toBe(false);
      const mutations: string[] = [];
      const off = fixture.view.onMutations('listitem', (changes) =>
        mutations.push(...changes.values())
      );
      const input = vi.spyOn(fixture.session, 'textFromView');
      const acknowledge = vi.spyOn(fixture.view, 'acknowledgeText');
      leaf.nodeValue = 'todo1. ';
      fixture.port.textFromView({
        key: node.key,
        text: 'todo1. ',
        anchorOffset: 7,
        focusOffset: 7,
      });
      off();
      expect(input).toHaveBeenCalledTimes(1);
      // This actual artifact emits listener metadata with its accepted text echo.
      expect(input.mock.results[0]).toEqual({ type: 'return', value: 1 });
      expect(acknowledge).toHaveBeenCalledTimes(1);
      expect(fixture.view.text(node.key)).toBe('todo1. ');
      expect(mutations).toEqual([]);
      expect(item.getAttribute('tabindex')).toBe(
        sourceItem.getAttribute('tabindex')
      );
      if (entry.nested)
        expect(fixture.root.querySelector('li')?.hasAttribute('tabindex')).toBe(
          false
        );
    } finally {
      cleanup();
      await fixture.close();
    }
  });
}

test('a text echo in an ordinary paragraph creates no checklist attributes', async () => {
  const fixture = await nativeAcknowledgementSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'todo' }],
            },
          ],
        },
      })
    );
    const node = [...fixture.view.mirror.values()].find(
      (node) => node.kind === 'text'
    );
    if (!node) throw new Error('Missing actual paragraph text');
    const element = fixture.view.getElementByKey(node.key);
    const leaf = element ? textLeaf(element) : null;
    if (!leaf) throw new Error('Missing actual paragraph DOM');
    leaf.nodeValue = 'todo1. ';
    fixture.port.textFromView({
      key: node.key,
      text: 'todo1. ',
      anchorOffset: 7,
      focusOffset: 7,
    });
    expect(
      fixture.root.querySelector('[role="checkbox"], [tabindex]')
    ).toBeNull();
    expect(fixture.view.text(node.key)).toBe('todo1. ');
  } finally {
    await fixture.close();
  }
});
