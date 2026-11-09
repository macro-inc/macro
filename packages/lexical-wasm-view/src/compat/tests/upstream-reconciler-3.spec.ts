/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { buildEditorFromExtensions, defineExtension } from '@lexical/extension';
import invariant from '@lexical/internal/invariant';
import { LinkExtension } from '@lexical/link';
import { RichTextExtension } from '@lexical/rich-text';
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  $isTextNode,
  type ElementDOMSlot,
  ElementNode,
} from 'lexical';
import { describe, expect, test } from 'vitest';

describe('children fast path: contiguous-suffix incremental update', () => {
  function createReconcilerEditor() {
    const editor = buildEditorFromExtensions(
      RichTextExtension,
      defineExtension({ name: 'reconciler-suffix-test' })
    );
    editor.setRootElement(document.createElement('div'));
    return editor;
  }

  // Shared test node: a block ElementNode whose keyed DOM (outer <div>)
  // differs from its slot.element (inner <section>). Used by AUDIT-5
  // and AUDIT-5b to exercise the wrapping-parent code path in the
  // suffix size-delta helper. Mirrors the structure of nodes like
  // TableNode that wrap their keyed DOM in a scrollable container.
  class BlockWrapperElementNode extends ElementNode {
    $config() {
      return this.config('audit_block_wrapper', {});
    }
    createDOM(): HTMLElement {
      const el = document.createElement('div');
      el.className = 'block-wrapper';
      const inner = document.createElement('section');
      inner.className = 'inner-slot';
      el.appendChild(inner);
      return el;
    }
    updateDOM(): boolean {
      return false;
    }
    getDOMSlot(dom: HTMLElement): ElementDOMSlot {
      return super.getDOMSlot(dom).withElement(dom.querySelector('section')!);
    }
  }

  function _$createBlockWrapperElementNode(): BlockWrapperElementNode {
    return $applyNodeReplacement(new BlockWrapperElementNode());
  }

  function _createReconcilerEditorWithLink() {
    const editor = buildEditorFromExtensions(
      RichTextExtension,
      LinkExtension,
      defineExtension({ name: 'reconciler-suffix-test-with-link' })
    );
    editor.setRootElement(document.createElement('div'));
    return editor;
  }

  test('typing at the end of the last paragraph keeps prefix DLB', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        for (const t of ['alpha', 'beta', 'gamma']) {
          root.append($createParagraphNode().append($createTextNode(t)));
        }
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('alpha\n\nbeta\n\ngamma');
    });

    editor.update(
      () => {
        const last = $getRoot().getLastChildOrThrow();
        invariant($isParagraphNode(last), 'last must be a ParagraphNode');
        const text = last.getFirstChildOrThrow();
        invariant($isTextNode(text), 'text must be a TextNode');
        text.setTextContent(text.getTextContent() + '!');
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('alpha\n\nbeta\n\ngamma!');
    });
  });

  test('multiple contiguous dirty children at the end', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        for (const t of ['a', 'b', 'c', 'd']) {
          root.append($createParagraphNode().append($createTextNode(t)));
        }
      },
      { discrete: true }
    );

    editor.update(
      () => {
        const root = $getRoot();
        const c = root.getChildAtIndex(2);
        const d = root.getChildAtIndex(3);
        invariant($isParagraphNode(c), 'c must be a ParagraphNode');
        invariant($isParagraphNode(d), 'd must be a ParagraphNode');
        const cText = c.getFirstChildOrThrow();
        const dText = d.getFirstChildOrThrow();
        invariant($isTextNode(cText), 'cText must be a TextNode');
        invariant($isTextNode(dText), 'dText must be a TextNode');
        cText.setTextContent('cc');
        dText.setTextContent('dd');
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('a\n\nb\n\ncc\n\ndd');
    });
  });

  test('non-contiguous dirty children take the existing fast path', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        for (const t of ['x', 'y', 'z']) {
          root.append($createParagraphNode().append($createTextNode(t)));
        }
      },
      { discrete: true }
    );

    editor.update(
      () => {
        const root = $getRoot();
        const first = root.getChildAtIndex(0);
        const third = root.getChildAtIndex(2);
        invariant($isParagraphNode(first), 'first must be a ParagraphNode');
        invariant($isParagraphNode(third), 'third must be a ParagraphNode');
        const firstText = first.getFirstChildOrThrow();
        const thirdText = third.getFirstChildOrThrow();
        invariant($isTextNode(firstText), 'firstText must be a TextNode');
        invariant($isTextNode(thirdText), 'thirdText must be a TextNode');
        firstText.setTextContent('xx');
        thirdText.setTextContent('zz');
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('xx\n\ny\n\nzz');
    });
  });

  test('format toggle on the last paragraph propagates to __textFormat', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        for (const t of ['head', 'foot']) {
          root.append($createParagraphNode().append($createTextNode(t)));
        }
      },
      { discrete: true }
    );

    editor.update(
      () => {
        const last = $getRoot().getLastChildOrThrow();
        invariant($isParagraphNode(last), 'last must be a ParagraphNode');
        const text = last.getFirstChildOrThrow();
        invariant($isTextNode(text), 'text must be a TextNode');
        text.toggleFormat('bold');
      },
      { discrete: true }
    );

    editor.read(() => {
      const root = $getRoot();
      const head = root.getFirstChildOrThrow();
      const foot = root.getLastChildOrThrow();
      invariant($isParagraphNode(head), 'head must be a ParagraphNode');
      invariant($isParagraphNode(foot), 'foot must be a ParagraphNode');
      // Each paragraph's __textFormat is sourced from its own first text
      // descendant — head is unchanged (its first text is plain), foot now
      // reflects the toggled bold flag.
      expect(head.getTextFormat()).toBe(0);
      expect(foot.getTextFormat()).not.toBe(0);
      expect(root.__cachedText).toBe('head\n\nfoot');
    });
  });

  test('empty trailing paragraph contributes zero length', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        root.append(
          $createParagraphNode().append($createTextNode('hello')),
          $createParagraphNode()
        );
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('hello\n\n');
    });

    editor.update(
      () => {
        const last = $getRoot().getLastChildOrThrow();
        invariant($isParagraphNode(last), 'last must be a ParagraphNode');
        last.append($createTextNode('world'));
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('hello\n\nworld');
    });
  });

  test('linebreak-bounded text nodes update suffix without extra DLB', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        const para = $createParagraphNode();
        para.append(
          $createTextNode('top'),
          $createLineBreakNode(),
          $createTextNode('bottom')
        );
        root.append(para);
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('top\nbottom');
    });

    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        const text = para.getLastChildOrThrow();
        invariant($isTextNode(text), 'text must be a TextNode');
        text.setTextContent('BOTTOM!');
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('top\nBOTTOM!');
    });
  });

  // Regression: prev-state size must come from the cached label on the
  // previous-state node instance. Going through `getTextContent()` would
  // resolve via `getLatest()` -> next state and miscompute oldSuffixLength
  // when the dirty tail TextNode's length actually changed.
  test('TextNode-direct-child suffix with length change: prefix preserved', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        const para = $createParagraphNode();
        para.append(
          $createTextNode('hello '),
          $createTextNode('world').toggleFormat('bold')
        );
        root.append(para);
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('hello world');
    });

    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        const text = para.getLastChildOrThrow();
        invariant($isTextNode(text), 'text must be a TextNode');
        text.setTextContent('world!!');
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().__cachedText).toBe('hello world!!');
    });
  });
});
