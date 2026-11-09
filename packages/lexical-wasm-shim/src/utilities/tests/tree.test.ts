import * as Original from 'lexical';
import { expect, test } from 'vitest';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from '../../index';
import {
  $createChildrenArray,
  $findMatchingParent,
  $getNearestRootOrShadowRoot,
  $hasAncestor,
  removeFromParent,
} from '../tree';

test('actual parent traversals and captured child-key chains match Original', () => {
  const original = Original.createEditor({
    onError(error) {
      throw error;
    },
  });
  let expected: unknown;
  original.update(
    () => {
      const root = Original.$getRoot();
      const parent = Original.$createParagraphNode();
      const child = Original.$createTextNode('text');
      root.append(parent);
      parent.append(child);
      expected = [
        Original.$findMatchingParent(child, Original.$isElementNode)?.getType(),
        Original.$findMatchingParent(root, () => true),
        Original.$hasAncestor(child, parent),
        Original.$hasAncestor(parent, child),
        Original.$getNearestRootOrShadowRoot(child).getType(),
        Original.$createChildrenArray(parent, null).length,
      ];
    },
    { discrete: true }
  );
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  try {
    editor.update(() => {
      const root = $getRoot();
      const parent = $createParagraphNode();
      const child = $createTextNode('text');
      root.append(parent);
      parent.append(child);
      expect([
        $findMatchingParent(
          child,
          (node) => node.getType() === 'paragraph'
        )?.getType(),
        $findMatchingParent(root, () => true),
        $hasAncestor(child, parent),
        $hasAncestor(parent, child),
        $getNearestRootOrShadowRoot(child).getType(),
        $createChildrenArray(parent, null).length,
      ]).toEqual(expected);
      expect(
        $createChildrenArray(parent, new Map([[child.getKey(), child]]))
      ).toEqual([child.getKey()]);
    });
  } finally {
    editor.dispose();
  }
});

test('raw tree field writes reject the unavailable capability without a substitute mutation', () => {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  try {
    editor.update(() => {
      const parent = $createParagraphNode();
      const child = $createTextNode('text');
      $getRoot().append(parent);
      parent.append(child);
      expect(() => removeFromParent(child)).toThrow(
        'backend field-write capability is required for __first'
      );
      expect(child.getParent()).toBe(parent);
      expect(parent.getChildren()).toEqual([child]);
    });
  } finally {
    editor.dispose();
  }
});
