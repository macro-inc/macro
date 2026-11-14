import {
  initializeNativeSurfaceTests,
  nativeSurface,
  transfer,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { beforeAll, expect, test, vi } from 'vitest';
import { behaviorEditor } from '../behavior-inventory/editor';
import { registerNativeDraggableBlock } from '../plugins/draggable-block/native';
import { createLexicalDraggableBlockHost } from './overlay-hosts/lexical-draggable-block';

beforeAll(initializeNativeSurfaceTests);

function dragStart(dataTransfer: DataTransfer): DragEvent {
  return Object.assign(new MouseEvent('dragstart', { bubbles: true }), {
    dataTransfer,
  });
}

// The actual Source adapter and native session run here; transfer and drag event
// are synthetic. Trusted drag/focus/DataTransfer evidence belongs to the browser.
test.each(['dragged', 'elsewhere'] as const)(
  'Source drag preparation leaves the %s caret and model untouched',
  (caret) => {
    const { editor } = behaviorEditor();
    let draggedKey = '';
    editor.update(
      () => {
        const first = $createParagraphNode().append($createTextNode('alpha'));
        const second = $createParagraphNode().append($createTextNode('bravo'));
        $getRoot().append(first, second);
        draggedKey = second.getKey();
        (caret === 'dragged' ? second : first).selectEnd();
      },
      { discrete: true }
    );
    const element = editor.getElementByKey(draggedKey);
    if (!element) throw new Error('Missing actual Source dragged paragraph');
    const before = editor.getEditorState();
    const json = before.toJSON();
    const data = transfer('');
    const preview = vi.spyOn(data, 'setDragImage');
    const updated = vi.fn();
    const unregister = editor.registerUpdateListener(updated);
    const host = createLexicalDraggableBlockHost(
      () => editor,
      () => {}
    );
    try {
      host.start(dragStart(data), element);
      expect(data.types).toEqual(['application/x-lexical-drag-block']);
      expect(data.getData('application/x-lexical-drag-block')).toBe(draggedKey);
      expect(data.effectAllowed).toBe('move');
      expect(preview).toHaveBeenCalledWith(element, 0, 0);
      expect(editor.getEditorState()).toBe(before);
      expect(editor.getEditorState().toJSON()).toEqual(json);
      expect(updated).not.toHaveBeenCalled();
      host.end();
      expect(editor.getEditorState()).toBe(before);
    } finally {
      unregister();
      preview.mockRestore();
    }
  }
);

test.each(['dragged', 'elsewhere'] as const)(
  'native drag preparation preserves the %s caret without publishing an input',
  (caret) => {
    const fixture = nativeSurface();
    let registration:
      | ReturnType<typeof registerNativeDraggableBlock>
      | undefined;
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: ['alpha', 'bravo'].map((text) => ({
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text }],
            })),
          },
        })
      );
      const selectedText = [...fixture.view.mirror.values()].find(
        (node) =>
          node.kind === 'text' &&
          node.text === (caret === 'dragged' ? 'bravo' : 'alpha')
      );
      const draggedText = [...fixture.view.mirror.values()].find(
        (node) => node.kind === 'text' && node.text === 'bravo'
      );
      if (!selectedText || !draggedText || draggedText.parent === null)
        throw new Error('Missing actual native fixture nodes');
      const element = fixture.view.getElementByKey(draggedText.parent);
      if (!element) throw new Error('Missing native dragged paragraph');
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key: selectedText.key, type: 'text', offset: 5 },
        focus: { key: selectedText.key, type: 'text', offset: 5 },
      });
      const before = structuredClone(fixture.view.selection());
      const json = fixture.view.query.serializedState();
      const admissions = fixture.counters.admissions;
      const revision = fixture.view.documentRevision;
      const data = transfer('');
      registration = registerNativeDraggableBlock(fixture.view, () => {});
      expect(registration.start(dragStart(data), element)).toBe(true);
      expect(fixture.view.selection()).toEqual(before);
      expect(fixture.counters.admissions).toBe(admissions);
      expect(fixture.view.documentRevision).toBe(revision);
      expect(fixture.view.query.serializedState()).toBe(json);
      expect(data.types).toEqual(['application/x-lexical-drag-block']);
      registration.end();
      expect(fixture.view.selection()).toEqual(before);
      expect(fixture.errors).toEqual([]);
    } finally {
      try {
        registration?.dispose();
      } finally {
        fixture.close();
      }
    }
  }
);
