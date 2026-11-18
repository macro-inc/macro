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
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
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

  // Verifies the cached-text-size invariant under sustained typing on the
  // same paragraph. The paragraph instance is propagated-dirty (not cloned)
  // across cycles, so any cache mechanism that can't refresh on a frozen-
  // from-prev-cycle instance — e.g. Symbol-keyed property + skip-if-frozen —
  // would read a stale cycle-0 size in cycle 2+ and produce a wrong splice.
  // Append a new paragraph at the end of a multi-paragraph root: root
  // children grow by 1, with the previous last paragraph cloned for its
  // `__next` link update and the appended paragraph dirty as new — so the
  // root's reconcile sees `sizeDelta=+1` and `K=2` dirty children at the
  // suffix. Verifies the generalized suffix path correctly destroys nothing,
  // reconciles the formerly-last paragraph, creates the new one, and
  // splices the cached text.
  test('append paragraph at end of multi-paragraph root (size+1, K=2)', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        for (const t of ['a', 'b', 'c', 'd', 'e']) {
          root.append($createParagraphNode().append($createTextNode(t)));
        }
      },
      { discrete: true }
    );
    editor.read(() => {
      expect($getRoot().__cachedText).toBe('a\n\nb\n\nc\n\nd\n\ne');
    });

    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('f')));
      },
      { discrete: true }
    );
    editor.read(() => {
      expect($getRoot().__cachedText).toBe('a\n\nb\n\nc\n\nd\n\ne\n\nf');
    });
  });

  // Remove the last paragraph from a multi-paragraph root: root children
  // shrink by 1, with the new last paragraph cloned for its `__next` link
  // update and the removed paragraph absent from next — so the root's
  // reconcile sees `sizeDelta=-1` and `K=1` dirty child at the suffix.
  // Verifies the generalized suffix path destroys the removed paragraph,
  // reconciles the new last, and splices the cached text.
  test('remove last paragraph of multi-paragraph root (size-1, K=1)', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        for (const t of ['a', 'b', 'c', 'd', 'e']) {
          root.append($createParagraphNode().append($createTextNode(t)));
        }
      },
      { discrete: true }
    );
    editor.read(() => {
      expect($getRoot().__cachedText).toBe('a\n\nb\n\nc\n\nd\n\ne');
    });

    editor.update(
      () => {
        $getRoot().getLastChildOrThrow().remove();
      },
      { discrete: true }
    );
    editor.read(() => {
      expect($getRoot().__cachedText).toBe('a\n\nb\n\nc\n\nd');
    });
  });

  test('sustained typing on the same paragraph stays correct (cache freshness)', () => {
    using editor = createReconcilerEditor();
    let textKey = '';

    // Multi-paragraph layout so the root-level suffix path actually fires
    // (K=1 dirty child of root, parent.__size=3 — suffix detection passes,
    // unlike a single-child root which falls through to Layer 1+2).
    editor.update(
      () => {
        const root = $getRoot().clear();
        root.append(
          $createParagraphNode().append($createTextNode('alpha')),
          $createParagraphNode().append($createTextNode('beta'))
        );
        const para = $createParagraphNode();
        const text = $createTextNode('x');
        textKey = text.getKey();
        para.append(text);
        root.append(para);
      },
      { discrete: true }
    );
    editor.read(() => {
      expect($getRoot().__cachedText).toBe('alpha\n\nbeta\n\nx');
    });

    for (const next of ['xy', 'xyz', 'xyzz']) {
      editor.update(
        () => {
          const text = $getNodeByKey(textKey);
          invariant($isTextNode(text), 'text must be a TextNode');
          text.setTextContent(next);
        },
        { discrete: true }
      );
      editor.read(() => {
        expect($getRoot().__cachedText).toBe(`alpha\n\nbeta\n\n${next}`);
      });
    }
  });

  // Sustained appends: each cycle exercises the size+1 / K=2 branch on
  // the root reconcile (the previous last paragraph is cloned for its
  // `__next` link update, the appended one is dirty as new). Verifies
  // that the root cached text stays accurate across many cycles, the
  // way the corresponding sustained-typing test does for the same-size
  // branch.
  test('sustained appends stay correct across cycles (cache freshness, size+1)', () => {
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
    editor.read(() => {
      expect($getRoot().__cachedText).toBe('a\n\nb\n\nc\n\nd');
    });

    const labels = ['e', 'f', 'g', 'h', 'i'];
    let expectedText = 'a\n\nb\n\nc\n\nd';
    for (const label of labels) {
      editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode(label))
          );
        },
        { discrete: true }
      );
      expectedText = `${expectedText}\n\n${label}`;
      editor.read(() => {
        expect($getRoot().__cachedText).toBe(expectedText);
      });
    }
  });

  // Sustained removes: each cycle exercises the size-1 / K=1 branch on
  // the root reconcile (the new last paragraph is cloned for its
  // `__next` link update, the removed one is gone in next). Same
  // freshness assertion as the append counterpart.
  test('sustained removes stay correct across cycles (cache freshness, size-1)', () => {
    using editor = createReconcilerEditor();

    const labels = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    editor.update(
      () => {
        const root = $getRoot().clear();
        for (const t of labels) {
          root.append($createParagraphNode().append($createTextNode(t)));
        }
      },
      { discrete: true }
    );
    editor.read(() => {
      expect($getRoot().__cachedText).toBe(labels.join('\n\n'));
    });

    // Remove 3 trailing paragraphs one cycle at a time. Stop while the
    // root still has 4 children so the MIN gate keeps the fast path
    // engaged the whole time.
    const remaining = labels.slice();
    for (let i = 0; i < 3; i++) {
      editor.update(
        () => {
          $getRoot().getLastChildOrThrow().remove();
        },
        { discrete: true }
      );
      remaining.pop();
      editor.read(() => {
        expect($getRoot().__cachedText).toBe(remaining.join('\n\n'));
      });
    }
  });

  // Reconcile intentionally does NOT propagate textFormat / textStyle
  // to RootNode / ShadowRootNode — `LexicalElementNode.exportJSON`
  // already excludes them (#7968) and selection inheritance only reads
  // element format/style for non-root anchors. The
  // `$reconcileChildrenWithDirection` gate skips the calls entirely so
  // root never picks up format from a descendant, regardless of which
  // children fast path runs.
  test('AUDIT-1: root __textFormat is not propagated from descendants', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        // Three empty paragraphs (no text descendants in the prefix) +
        // one paragraph with plain text. Total 4 children, which clears
        // MIN_FAST_PATH_CHILDREN=4 so the suffix path engages.
        root.append(
          $createParagraphNode(),
          $createParagraphNode(),
          $createParagraphNode(),
          $createParagraphNode().append($createTextNode('x'))
        );
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().getTextFormat()).toBe(0);
    });

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
      const last = root.getLastChildOrThrow();
      invariant($isParagraphNode(last), 'last must be a ParagraphNode');
      // Inner reconcile of the last paragraph still updates its own
      // __textFormat — paragraphs are not gated.
      expect(last.getTextFormat()).not.toBe(0);
      // Root is intentionally NOT updated — the gate suppresses it.
      expect(root.getTextFormat()).toBe(0);
    });
  });

  // Companion / sanity test: when the prefix DOES have a text
  // descendant, the suffix-path clear is correct (the parent's
  // __textFormat is sourced from the prefix and shouldn't change). This
  // documents what the clear is protecting against, and locks in the
  // expected behavior so a fix to #1 doesn't regress this case.
  test('AUDIT-1 control: prefix with text keeps parent __textFormat stable', () => {
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

    editor.read(() => {
      expect($getRoot().getTextFormat()).toBe(0);
    });

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
      const last = root.getLastChildOrThrow();
      invariant($isParagraphNode(last), 'last must be a ParagraphNode');
      expect(last.getTextFormat()).not.toBe(0);
      // First text descendant of root is 'a' in the prefix — plain.
      // root.__textFormat must NOT pick up the suffix's bold.
      expect(root.getTextFormat()).toBe(0);
    });
  });
});
