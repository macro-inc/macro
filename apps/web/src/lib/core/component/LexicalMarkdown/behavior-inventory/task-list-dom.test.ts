import { $generateHtmlFromNodes } from '@lexical/html';
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListType,
} from '@lexical/list';
import {
  $isTaskListNode,
  TASK_LIST_BAR_CLASS,
} from '@macro-inc/lexical-core/nodes/TaskListNode';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { createChecklistControls } from '../plugins/checklist-controls/checklistControlsPlugin';
import { behaviorEditor } from './editor';

function mountList(editor: LexicalEditor, type: ListType) {
  let key = '';
  editor.update(
    () => {
      const list = $createListNode(type, 4);
      key = list.getKey();
      list.append(
        $createListItemNode(false).append($createTextNode('first')),
        $createListItemNode(true).append($createTextNode('second'))
      );
      $getRoot().append(list);
    },
    { discrete: true }
  );
  const element = editor.getElementByKey(key);
  if (!element) throw new Error('Missing mounted list');
  return { key, element };
}

describe('mounted task list DOM slots', () => {
  it.each(['check', 'number', 'bullet'] as const)(
    'mounts %s lists with chrome only for checklists',
    (type) => {
      const { editor } = behaviorEditor();
      const { key, element } = mountList(editor, type);
      editor.read(() => expect($isTaskListNode($getNodeByKey(key))).toBe(true));
      expect(element.tagName).toBe(type === 'number' ? 'OL' : 'UL');
      expect(element.querySelectorAll(':scope > li')).toHaveLength(2);
      const bar = element.querySelector<HTMLElement>(
        `:scope > .${TASK_LIST_BAR_CLASS}`
      );
      if (type === 'check') {
        expect(bar).toBe(element.firstElementChild);
        // jsdom exposes this property without native attribute reflection.
        expect(bar?.contentEditable).toBe('false');
        const rows = element.querySelectorAll(':scope > li');
        expect([...rows].map((row) => row.getAttribute('role'))).toEqual([
          'checkbox',
          'checkbox',
        ]);
        expect(
          [...rows].map((row) => row.getAttribute('aria-checked'))
        ).toEqual(['false', 'true']);
      } else {
        expect(bar).toBeNull();
        expect(element.firstElementChild?.tagName).toBe('LI');
      }
    }
  );

  it.each([
    ['check', 'bullet'],
    ['check', 'number'],
    ['bullet', 'check'],
    ['bullet', 'number'],
    ['number', 'check'],
    ['number', 'bullet'],
  ] as const)(
    'replaces the list DOM and chrome when kind changes from %s to %s',
    (from, to) => {
      const { editor } = behaviorEditor();
      const { key, element } = mountList(editor, from);
      const oldBar = element.querySelector(`:scope > .${TASK_LIST_BAR_CLASS}`);
      editor.update(
        () => {
          const node = $getNodeByKey(key);
          if (!$isListNode(node)) throw new Error('Expected list');
          node.setListType(to);
        },
        { discrete: true }
      );
      const next = editor.getElementByKey(key);
      if (!next) throw new Error('Missing updated DOM');
      expect(next).not.toBe(element);
      expect(element.isConnected).toBe(false);
      if (oldBar) expect(oldBar.isConnected).toBe(false);
      expect(next.tagName).toBe(to === 'number' ? 'OL' : 'UL');
      expect(
        [...next.querySelectorAll(':scope > li')].map((row) => row.textContent)
      ).toEqual(['first', 'second']);
      expect(
        next.querySelectorAll(`:scope > .${TASK_LIST_BAR_CLASS}`)
      ).toHaveLength(to === 'check' ? 1 : 0);
      expect(
        next.querySelectorAll(':scope > li[role="checkbox"]')
      ).toHaveLength(to === 'check' ? 2 : 0);
      editor.read(() => {
        const node = $getNodeByKey(key);
        if (!$isListNode(node)) throw new Error('Expected list');
        expect(node.getListType()).toBe(to);
      });
    }
  );

  it('updates an ordered start in place without replacing managed item DOM', () => {
    const { editor } = behaviorEditor();
    const { key, element } = mountList(editor, 'number');
    const items = [...element.querySelectorAll(':scope > li')];
    editor.update(
      () => {
        const node = $getNodeByKey(key);
        if (!$isListNode(node)) throw new Error('Expected list');
        node.setStart(9);
      },
      { discrete: true }
    );
    expect(editor.getElementByKey(key)).toBe(element);
    expect(element.getAttribute('start')).toBe('9');
    const nextItems = [...element.querySelectorAll(':scope > li')];
    expect(nextItems[0]).toBe(items[0]);
    expect(nextItems[1]).toBe(items[1]);
    editor.read(() => {
      const node = $getNodeByKey(key);
      if (!$isListNode(node)) throw new Error('Expected list');
      expect(node.getStart()).toBe(9);
    });
  });

  for (const operation of ['text', 'append', 'remove', 'reorder'] as const) {
    it(`preserves unmanaged toolbar identity and content through a committed ${operation} edit`, () => {
      const { editor } = behaviorEditor();
      const { key, element } = mountList(editor, 'check');
      const bar = element.querySelector(`:scope > .${TASK_LIST_BAR_CLASS}`);
      if (!bar) throw new Error('Missing toolbar mount');
      // This host-owned sentinel proves range ownership. It is not the
      // production portal controls and does not establish their UI behavior.
      const sentinel = document.createElement('span');
      sentinel.textContent = 'fixture toolbar';
      bar.append(sentinel);
      editor.update(
        () => {
          const list = $getNodeByKey(key);
          if (!$isListNode(list)) throw new Error('Missing list model');
          const first = list.getFirstChildOrThrow();
          const second = list.getLastChildOrThrow();
          if (!$isListItemNode(first) || !$isListItemNode(second))
            throw new Error('Missing items');
          if (operation === 'text')
            first.clear().append($createTextNode('changed'));
          else if (operation === 'append')
            list.append(
              $createListItemNode(false).append($createTextNode('third'))
            );
          else if (operation === 'remove') first.remove();
          else second.insertAfter(first);
        },
        { discrete: true }
      );
      expect(editor.getElementByKey(key)).toBe(element);
      expect(element.firstElementChild).toBe(bar);
      expect(
        element.querySelectorAll(`:scope > .${TASK_LIST_BAR_CLASS}`)
      ).toHaveLength(1);
      expect(bar.firstChild).toBe(sentinel);
      expect(sentinel.textContent).toBe('fixture toolbar');
      const expected =
        operation === 'text'
          ? ['changed', 'second']
          : operation === 'append'
            ? ['first', 'second', 'third']
            : operation === 'remove'
              ? ['second']
              : ['second', 'first'];
      expect(
        [...element.querySelectorAll(':scope > li')].map(
          (row) => row.textContent
        )
      ).toEqual(expected);
      expect(editor.read(() => $getRoot().getTextContent())).not.toContain(
        'fixture toolbar'
      );
    });
  }

  it('excludes unmanaged chrome from exported clipboard HTML while retaining both item labels', () => {
    const { editor } = behaviorEditor();
    const { element } = mountList(editor, 'check');
    const bar = element.querySelector(`:scope > .${TASK_LIST_BAR_CLASS}`);
    if (!bar) throw new Error('Missing toolbar mount');
    bar.textContent = 'fixture toolbar';
    const html = editor.read(() => $generateHtmlFromNodes(editor));
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelector(`.${TASK_LIST_BAR_CLASS}`)).toBeNull();
    expect(html).not.toContain('fixture toolbar');
    expect(
      [...parsed.querySelectorAll('li')].map((row) => row.textContent)
    ).toEqual(['first', 'second']);
    // Export must not detach or modify the live unmanaged host element.
    expect(element.firstElementChild).toBe(bar);
    expect(bar.textContent).toBe('fixture toolbar');
  });

  it.each(['check', 'number', 'bullet'] as const)(
    'upgrades dirty legacy %s list JSON through the production controls transform',
    (type) => {
      const { plugin } = createChecklistControls();
      const { editor, root } = behaviorEditor(plugin);
      mountList(editor, type);
      const state = editor.getEditorState().toJSON();
      const list = state.root.children[0];
      expect(list.type).toBe('task-list');
      list.type = 'list';
      editor.setEditorState(editor.parseEditorState(state));
      // JSON parsing bypasses factory replacements. Exercise the host's
      // registered transform on an explicit committed dirty-node update.
      editor.update(() => $getRoot().getFirstChildOrThrow().markDirty(), {
        discrete: true,
      });
      editor.read(() => {
        const node = $getRoot().getFirstChildOrThrow();
        expect($isTaskListNode(node)).toBe(true);
        if (!$isListNode(node)) throw new Error('Expected list');
        expect(node.getListType()).toBe(type);
        expect(node.getStart()).toBe(4);
        expect(node.getChildren().map((item) => item.getTextContent())).toEqual(
          ['first', 'second']
        );
      });
      expect(root.querySelectorAll(`.${TASK_LIST_BAR_CLASS}`)).toHaveLength(
        type === 'check' ? 1 : 0
      );
    }
  );

  it('detaches the unmanaged chrome when its owning list is removed', () => {
    const { editor, root } = behaviorEditor();
    const { key, element } = mountList(editor, 'check');
    const bar = element.querySelector(`:scope > .${TASK_LIST_BAR_CLASS}`);
    editor.update(
      () => {
        $getNodeByKey(key)?.remove();
        $getRoot().append(
          $createParagraphNode().append($createTextNode('retained'))
        );
      },
      { discrete: true }
    );
    expect(element.isConnected).toBe(false);
    expect(bar?.isConnected).toBe(false);
    expect(root.querySelector(`.${TASK_LIST_BAR_CLASS}`)).toBeNull();
    expect(root.textContent).toBe('retained');
  });
});
