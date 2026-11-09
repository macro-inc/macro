import { expect, test } from 'vitest';
import { $getRoot, createEditor, TextNode } from '../index';
import { ArtificialNode__DO_NOT_USE } from '../nodes/artificial';
import { $applyNodeReplacement, $create } from '../nodes/replacement/helpers';

test('editor owns the prepared defaults and preserves omitted-config inheritance', () => {
  const parent = createEditor();
  try {
    expect([...parent._nodes.keys()]).toEqual([
      'root',
      'text',
      'linebreak',
      'tab',
      'paragraph',
      'artificial',
    ]);
    expect(parent._nodes.get('artificial')?.klass).toBe(
      ArtificialNode__DO_NOT_USE
    );
    parent.update(
      () => {
        const inherited = createEditor();
        const explicit = createEditor({ parentEditor: parent });
        try {
          expect(inherited._nodes).toBe(parent._nodes);
          expect(explicit._nodes).not.toBe(parent._nodes);
          expect(explicit._nodes.get('text')?.klass).toBe(TextNode);
        } finally {
          inherited.dispose();
          explicit.dispose();
        }
      },
      { discrete: true }
    );
  } finally {
    parent.dispose();
  }
});

test('node config getter is sampled once before passing prepared rows to the backend', () => {
  let reads = 0;
  const editor = createEditor({
    get nodes() {
      reads++;
      return [TextNode];
    },
  });
  try {
    expect(reads).toBe(1);
    expect(editor._nodes.get('text')?.klass).toBe(TextNode);
    editor.update(
      () => {
        const text = $create(TextNode);
        text.setTextContent('registered');
        expect($applyNodeReplacement(text)).toBe(text);
        // Root children must be elements; use a real paragraph constructor.
        expect(text.getType()).toBe('text');
        expect($getRoot().getChildrenSize()).toBe(0);
      },
      { discrete: true }
    );
    editor.read(() => {
      expect(() => $create(TextNode)).toThrow(
        'Cannot use method in read-only mode.'
      );
    });
    expect(reads).toBe(1);
  } finally {
    editor.dispose();
  }
});
