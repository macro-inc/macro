import { expect, test } from 'vitest';
import { $getRoot, createEditor, getActiveEditor } from '../editor';
import { ParagraphNode, RootNode, TextNode } from '../nodes';

test('state maps resolve exact historical captures without changing the active editor', () => {
  const editor = createEditor();
  const other = createEditor();
  try {
    const initial = editor.getEditorState();
    let textKey = '';
    editor.update(
      () => {
        const text = new TextNode('before');
        textKey = text.getKey();
        $getRoot().append(new ParagraphNode().append(text));
      },
      { discrete: true }
    );
    const before = editor.getEditorState();
    const oldMap = before._nodeMap;
    const oldText = oldMap.get(textKey);
    expect(oldText).toBeInstanceOf(TextNode);
    expect(oldMap).toBe(before._nodeMap);
    expect(oldMap.size).toBe(3);
    expect(oldMap.has('root')).toBe(true);
    expect(oldMap.get('root')).toBeInstanceOf(RootNode);
    expect(oldMap.has('missing')).toBe(false);
    expect(oldMap.get('missing')).toBeUndefined();
    editor.update(
      () => {
        const text = $getRoot().getFirstDescendant();
        if (!(text instanceof TextNode))
          throw new Error('Expected actual text');
        text.setTextContent('after');
      },
      { discrete: true }
    );
    other.read(() => {
      expect(getActiveEditor()).toBe(other);
      const latestMap = editor.getEditorState()._nodeMap;
      expect(getActiveEditor()).toBe(other);
      expect(latestMap.get(textKey)).not.toBe(oldText);
      expect(latestMap.size).toBe(3);
      expect(initial._nodeMap.size).toBe(1);
      expect(initial._nodeMap.has(textKey)).toBe(false);
      expect([...oldMap.values()]).toContain(oldText);
      if (!(oldText instanceof TextNode))
        throw new Error('Expected captured text');
      expect(oldText.__text).toBe('before');
      const latest = latestMap.get(textKey);
      if (!(latest instanceof TextNode))
        throw new Error('Expected current text');
      expect(latest.__text).toBe('after');
    });
  } finally {
    other.dispose();
    editor.dispose();
  }
});
