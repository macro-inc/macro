/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { buildEditorFromExtensions, defineExtension } from '@lexical/extension';
import invariant from '@lexical/internal/invariant';
import { $createLinkNode, LinkExtension } from '@lexical/link';
import { RichTextExtension } from '@lexical/rich-text';
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
  type ElementDOMSlot,
  ElementNode,
  type SerializedElementNode,
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

  function createReconcilerEditorWithLink() {
    const editor = buildEditorFromExtensions(
      RichTextExtension,
      LinkExtension,
      defineExtension({ name: 'reconciler-suffix-test-with-link' })
    );
    editor.setRootElement(document.createElement('div'));
    return editor;
  }

  // Companion to AUDIT-1 (non-root): when the prefix DOES carry the
  // canonical first text descendant, the suffix path must NOT bubble
  // the suffix's format up to the parent. The cached __lexicalFirstTextKey
  // identifies the prefix child as authoritative via the dirty-set probe.
  test('AUDIT-1 (non-root) control: prefix with text keeps paragraph __textFormat stable', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        const para = $createParagraphNode();
        // Plain text first, then 3 line breaks, then a final text. The
        // first text descendant is the plain "head" — paragraph's
        // __textFormat must reflect 0 even after the trailing text is
        // bolded.
        para.append(
          $createTextNode('head'),
          $createLineBreakNode(),
          $createLineBreakNode(),
          $createTextNode('tail')
        );
        root.append(para);
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      expect(para.getTextFormat()).toBe(0);
    });

    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        const tail = para.getLastChildOrThrow();
        invariant($isTextNode(tail), 'tail must be a TextNode');
        tail.toggleFormat('bold');
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      // First text descendant ("head") is in the non-dirty prefix, so
      // its format (0) wins. The bolded "tail" is in the suffix and
      // must NOT bubble to the parent.
      expect(para.getTextFormat()).toBe(0);
    });
  });

  // Audit finding #1 (non-root variant): the same bug reproduces on a
  // *paragraph* whose prefix has no text descendants — e.g. line breaks
  // followed by a text node. Skipping `reconcileTextFormat` for
  // `$isRootOrShadowRoot` would not fix this case, since the paragraph's
  // own __textFormat is read by selection logic and JSON serialization.
  test('AUDIT-1 (non-root): paragraph with linebreak-only prefix leaks stale __textFormat', () => {
    using editor = createReconcilerEditor();

    editor.update(
      () => {
        const root = $getRoot().clear();
        const para = $createParagraphNode();
        // Three line breaks (non-text leaves, no text descendants in the
        // prefix) + a final text node "x". 4 inline children total, so
        // MIN_FAST_PATH_CHILDREN=4 is met when this paragraph is the
        // reconcile parent.
        para.append(
          $createLineBreakNode(),
          $createLineBreakNode(),
          $createLineBreakNode(),
          $createTextNode('x')
        );
        root.append(para);
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      expect(para.getTextFormat()).toBe(0);
    });

    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        const text = para.getLastChildOrThrow();
        invariant($isTextNode(text), 'text must be a TextNode');
        text.toggleFormat('bold');
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      // First (and only) text descendant of the paragraph is the bold
      // "x". paragraph.__textFormat must reflect that — it's used by
      // selection inheritance and JSON serialization.
      expect(para.getTextFormat()).not.toBe(0);
    });
  });

  // Regression: the general same-size walk (taken when the parent has many
  // children but suffix-incremental can't fire because no contiguous tail
  // is preserved) must capture both the format/style and the key of the
  // first direct TextNode child, so `dom.__lexicalFirstTextKey` is written
  // for the next cycle's `$resolveSuffixPathFormat` to find. If the key is
  // missing, the next cycle's helper takes the "no prefix text descendant"
  // branch and propagates the wrong text's format to the parent.
  test('general same-size walk caches first-text key on the parent DOM', () => {
    using editor = createReconcilerEditor();

    // 4 direct TextNode children with *distinct* formats so lexical's
    // TextNode normalization doesn't merge them after the cycle-2
    // style sweep. Without this, the 4 children collapse to 1 and
    // `paragraph.__size` drops below MIN_FAST_PATH_CHILDREN — the wrong
    // path for this regression. First child 'a' stays format-0 so the
    // assertion (`paragraph.__textFormat === 0`) reflects 'a's format.
    editor.update(
      () => {
        const root = $getRoot().clear();
        const para = $createParagraphNode();
        para.append(
          $createTextNode('a'),
          $createTextNode('b').toggleFormat('bold'),
          $createTextNode('c').toggleFormat('italic'),
          $createTextNode('d').toggleFormat('code')
        );
        root.append(para);
      },
      { discrete: true }
    );

    // Cycle 2: re-style every child. All 4 children dirty → suffix-
    // incremental bails (`$suffixStartIfContiguous` returns null when
    // dirty.size >= parent.__size) → general same-size walk runs →
    // `dom.__lexicalFirstTextKey` must be written from the post-walk
    // module state. The C1 fix is exactly this capture site.
    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        for (const child of para.getChildren()) {
          invariant($isTextNode(child), 'child must be a TextNode');
          child.setStyle('color: red');
        }
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      // Confirm normalization didn't merge the children.
      expect(para.getChildren()).toHaveLength(4);
      const firstChildKey = para.getFirstChildOrThrow().__key;
      const dom = editor.getElementByKey(para.__key) as
        | (HTMLElement & { __lexicalFirstTextKey?: unknown })
        | null;
      expect(dom?.__lexicalFirstTextKey).toBe(firstChildKey);
      expect(para.getTextFormat()).toBe(0);
    });

    // Cycle 3: format-toggle only the last child. 1 dirty child + 4-child
    // parent → suffix-incremental fires → `$resolveSuffixPathFormat`
    // reads the cached first-text key from cycle 2. If C1's capture were
    // missing, that key would be null and the helper would take the
    // "no prefix text" branch, propagating the last child's format up.
    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        const last = para.getLastChildOrThrow();
        invariant($isTextNode(last), 'last must be a TextNode');
        last.toggleFormat('underline');
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      // First text descendant 'a' is still format 0 — parent must reflect
      // that, not 'd's (code | underline).
      expect(para.getTextFormat()).toBe(0);
    });
  });

  // Regression: the suffix walks (both the same-size loop in
  // `$reconcileChildren` and the ops loop in `$tryReconcileSuffixWithSizeDelta`)
  // recursively reconcile element children, and `$reconcileChildrenWithDirection`
  // resets the module state at entry. Without save/restore, each iteration
  // clobbers the previous one and the walk ends with the *last* suffix
  // element child's first-text descendant, not the first. When the prefix
  // has no text descendant, the parent then gets the wrong text's format
  // propagated up.
  test('suffix walk keeps the leftmost first-text descriptor across element-child iterations', () => {
    using editor = createReconcilerEditorWithLink();

    editor.update(
      () => {
        const root = $getRoot().clear();
        const para = $createParagraphNode();
        // Prefix has no text descendants (3 line breaks). Suffix has two
        // links carrying text — X bold, Y italic. Total 5 inline children
        // ≥ MIN_FAST_PATH_CHILDREN.
        const linkX = $createLinkNode('https://x.example');
        linkX.append($createTextNode('X').toggleFormat('bold'));
        const linkY = $createLinkNode('https://y.example');
        linkY.append($createTextNode('Y').toggleFormat('italic'));
        para.append(
          $createLineBreakNode(),
          $createLineBreakNode(),
          $createLineBreakNode(),
          linkX,
          linkY
        );
        root.append(para);
      },
      { discrete: true }
    );

    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        // Dirty the text inside both links by re-styling. Dirty propagation
        // marks the parent link (and paragraph) as dirty too, so each link
        // goes through the suffix walk's recursive reconcile — that's where
        // the previous-iteration module state would get clobbered.
        for (const child of para.getChildren()) {
          if ($isElementNode(child)) {
            const innerText = child.getFirstChild();
            if (innerText !== null && $isTextNode(innerText)) {
              innerText.setStyle('color: red');
            }
          }
        }
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      // First text descendant in DFS order is X (bold). Parent must
      // reflect X's format, not Y's.
      const TEXT_FORMAT_BOLD = 1;
      expect(para.getTextFormat()).toBe(TEXT_FORMAT_BOLD);
    });
  });

  // AUDIT-2: when the suffix attempt bails (non-contiguous dirty) and
  // the Layer 2 same-size general walk fires, each dirty ElementNode
  // child's recursive reconcile resets the module state at entry and
  // overwrites whatever earlier non-dirty children's caches would
  // contribute. Layer 2 has no save/restore (unlike the suffix walks
  // fixed in commit 9207234), so the parent ends up reflecting the
  // *middle* dirty child's first-text descendant instead of the
  // leftmost. The leftmost prefix child carries the canonical first
  // text descendant in DFS order and should win.
  test('AUDIT-2: Layer 2 walk writes wrong __lexicalFirstTextKey when middle child is dirty', () => {
    using editor = createReconcilerEditorWithLink();

    editor.update(
      () => {
        const root = $getRoot().clear();
        const para = $createParagraphNode();
        const linkA = $createLinkNode('https://a.example');
        // textA carries bold so the post-cycle-2 assertion
        // distinguishes leftmost-wins (paragraph reflects bold) from
        // both "no propagation" (would stay at construct default 0)
        // and "later-dirty wins" (would reflect textC's code).
        linkA.append($createTextNode('a').toggleFormat('bold'));
        const linkB = $createLinkNode('https://b.example');
        linkB.append($createTextNode('b').toggleFormat('italic'));
        const linkC = $createLinkNode('https://c.example');
        linkC.append($createTextNode('c').toggleFormat('code'));
        const linkD = $createLinkNode('https://d.example');
        linkD.append($createTextNode('d').toggleFormat('underline'));
        para.append(linkA, linkB, linkC, linkD);
        root.append(para);
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      // Initial render via $createNode doesn't go through
      // reconcileTextFormat, so __textFormat stays at the constructor
      // default (0). This is pre-existing behavior independent of the
      // bug under test.
      expect(para.getTextFormat()).toBe(0);
    });

    // Cycle 2: re-style only the third link's text (textC, code format).
    // textC is dirty, propagates to linkC and P. dirtyChildren_map for
    // P = {linkC}. Non-contiguous suffix → suffix attempt bails →
    // Layer 2 same-size walk fires.
    const TEXT_FORMAT_CODE = 16;
    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        const linkC = para.getChildAtIndex(2);
        invariant($isElementNode(linkC), 'linkC must be element');
        const textC = linkC.getFirstChildOrThrow();
        invariant($isTextNode(textC), 'textC must be text');
        textC.setStyle('color: red');
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      const dom = editor.getElementByKey(para.__key) as
        | (HTMLElement & { __lexicalFirstTextKey?: unknown })
        | null;
      const linkA = para.getChildAtIndex(0);
      invariant($isElementNode(linkA), 'linkA must be element');
      const textAKey = linkA.getFirstChildOrThrow().__key;
      // Bug shape: Layer 2 walks all 4 link children, only linkC
      // recurses. linkC's reset+capture leaks textC's format/key to
      // the parent scope. After the walk:
      //   - subTreeFirstTextKey = textC_key, NOT textA_key.
      //   - reconcileTextFormat(P) sets P.__textFormat to textC's
      //     format (code), even though the first DFS text descendant
      //     (textA, bold) didn't change.
      //
      // Expected with the leftmost-wins fix:
      //   - dom.__lexicalFirstTextKey === textAKey.
      //   - para.getTextFormat() === BOLD (textA's format).
      const TEXT_FORMAT_BOLD = 1;
      expect(dom?.__lexicalFirstTextKey).toBe(textAKey);
      expect(para.getTextFormat()).toBe(TEXT_FORMAT_BOLD);
      void TEXT_FORMAT_CODE;
    });
  });

  // AUDIT-3: same bug pattern in $reconcileNodeChildren (the general
  // two-pointer walk for cases like middle-insert that the fast paths
  // can't handle). Each recursive `$reconcileNode` for an element
  // child runs through `$reconcileChildrenWithDirection`'s reset.
  // Without save/restore around the call, only the *last* iteration's
  // first-text descriptor survives — `dom.__lexicalFirstTextKey` is
  // written incorrectly and `reconcileTextFormat` propagates the
  // wrong child's format.
  test('AUDIT-3: $reconcileNodeChildren writes wrong cache after middle-insert', () => {
    using editor = createReconcilerEditorWithLink();

    editor.update(
      () => {
        const root = $getRoot().clear();
        const para = $createParagraphNode();
        const linkA = $createLinkNode('https://a.example');
        linkA.append($createTextNode('a').toggleFormat('bold'));
        const linkB = $createLinkNode('https://b.example');
        linkB.append($createTextNode('b').toggleFormat('italic'));
        const linkD = $createLinkNode('https://d.example');
        linkD.append($createTextNode('d').toggleFormat('underline'));
        para.append(linkA, linkB, linkD);
        root.append(para);
      },
      { discrete: true }
    );

    // Cycle 2: insert linkC between B and D. sizeDelta=+1 (3 → 4) but
    // suffix-incremental fast path bails because prevChildrenSize=3 is
    // below MIN_FAST_PATH_CHILDREN=4. Falls to $reconcileNodeChildren.
    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        const linkD = para.getChildAtIndex(2);
        invariant($isElementNode(linkD), 'linkD must be element');
        const linkC = $createLinkNode('https://c.example');
        linkC.append($createTextNode('c').toggleFormat('code'));
        linkD.insertBefore(linkC);
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow();
      invariant($isParagraphNode(para), 'para must be a ParagraphNode');
      const linkA = para.getChildAtIndex(0);
      invariant($isElementNode(linkA), 'linkA must be element');
      const textAKey = linkA.getFirstChildOrThrow().__key;
      const dom = editor.getElementByKey(para.__key) as
        | (HTMLElement & { __lexicalFirstTextKey?: unknown })
        | null;
      // The parent's first DFS text descendant didn't change (still
      // textA, format 0). `__lexicalFirstTextKey` should reflect that.
      // Bug: $reconcileNodeChildren's last reconciled element child's
      // first-text key wins.
      expect(dom?.__lexicalFirstTextKey).toBe(textAKey);
    });
  });

  // AUDIT-4: when an ElementNode wraps its keyed DOM in an outer element
  // (TableNode wraps a <table> in a scrollable <div>; this test uses a
  // simpler `<main><section>...</section></main>` wrapper to keep
  // setup self-contained), the cache is written to the slot.element
  // (inner `<section>`), not the keyed DOM (outer `<main>`).
  //
  // `$bubbleChildFirstText(dom)` in `$reconcileNode`'s !isDirty branches
  // reads `dom.__lexicalFirstTextKey` directly off the keyed DOM. For
  // wrapper elements the keyed DOM has no cache, so the bubble silently
  // skips and the parent's first-text capture loses this child.
  //
  // When the wrapper element is the leftmost child carrying the
  // canonical first text descendant, this means the parent's
  // `__lexicalFirstTextKey` is wrong, and `reconcileTextFormat` picks
  // up a later dirty sibling's format instead.
  test('AUDIT-4: $bubbleChildFirstText misses cache on elements with wrapping DOM', () => {
    class WrapperElementNode extends ElementNode {
      static getType(): string {
        return 'audit_wrapper';
      }
      static clone(node: WrapperElementNode): WrapperElementNode {
        return new WrapperElementNode(node.__key);
      }
      createDOM(): HTMLElement {
        const el = document.createElement('main');
        el.appendChild(document.createElement('section'));
        return el;
      }
      updateDOM(): boolean {
        return false;
      }
      getDOMSlot(dom: HTMLElement): ElementDOMSlot {
        return super.getDOMSlot(dom).withElement(dom.querySelector('section')!);
      }
      isInline(): boolean {
        return true;
      }
      exportJSON(): SerializedElementNode {
        throw new Error('Not implemented');
      }
      static importJSON(): WrapperElementNode {
        throw new Error('Not implemented');
      }
    }
    function $createWrapperElementNode(): WrapperElementNode {
      return $applyNodeReplacement(new WrapperElementNode());
    }

    const editor = buildEditorFromExtensions(
      RichTextExtension,
      LinkExtension,
      defineExtension({
        name: 'wrapper-audit',
        nodes: [WrapperElementNode],
      })
    );
    editor.setRootElement(document.createElement('div'));

    try {
      editor.update(
        () => {
          const root = $getRoot().clear();
          const para = $createParagraphNode();
          // Wrapper element (with internal slot != keyed DOM) at the
          // head, carrying the canonical first text descendant (textA,
          // bold). 4 inline children → Layer 2 walk on para in cycle 2.
          const wrapper = $createWrapperElementNode();
          wrapper.append($createTextNode('a').toggleFormat('bold'));
          const linkB = $createLinkNode('https://b.example');
          linkB.append($createTextNode('b').toggleFormat('italic'));
          const linkC = $createLinkNode('https://c.example');
          linkC.append($createTextNode('c').toggleFormat('code'));
          const linkD = $createLinkNode('https://d.example');
          linkD.append($createTextNode('d').toggleFormat('underline'));
          para.append(wrapper, linkB, linkC, linkD);
          root.append(para);
        },
        { discrete: true }
      );

      // Cycle 2: dirty only the middle link's text. Suffix attempt
      // bails (non-contiguous). Layer 2 walks. The wrapper element is
      // non-dirty: `$bubbleChildFirstText(wrapper.keyedDOM)` should
      // pick up the cached first-text key from the wrapper's section
      // (inner slot), but reads keyed DOM (outer main) which has no
      // cache.
      editor.update(
        () => {
          const para = $getRoot().getFirstChildOrThrow();
          invariant($isParagraphNode(para), 'para must be a ParagraphNode');
          const linkC = para.getChildAtIndex(2);
          invariant($isElementNode(linkC), 'linkC must be element');
          const textC = linkC.getFirstChildOrThrow();
          invariant($isTextNode(textC), 'textC must be text');
          textC.setStyle('color: red');
        },
        { discrete: true }
      );

      editor.read(() => {
        const para = $getRoot().getFirstChildOrThrow();
        invariant($isParagraphNode(para), 'para must be a ParagraphNode');
        const wrapper = para.getChildAtIndex(0);
        invariant($isElementNode(wrapper), 'wrapper must be element');
        const textAKey = wrapper.getFirstChildOrThrow().__key;
        const TEXT_FORMAT_BOLD = 1;
        // First DFS text descendant is textA inside the wrapper. The
        // parent's __textFormat must reflect bold.
        expect(para.getTextFormat()).toBe(TEXT_FORMAT_BOLD);
        // The keyed DOM (outer main) has no cache. We verify the bug
        // shape by reading the parent's __lexicalFirstTextKey: it
        // should be textA's key (from wrapper) but is the dirty child's
        // text key because the bubble silently skipped the wrapper.
        const paraDom = editor.getElementByKey(para.__key) as
          | (HTMLElement & { __lexicalFirstTextKey?: unknown })
          | null;
        expect(paraDom?.__lexicalFirstTextKey).toBe(textAKey);
      });
    } finally {
      editor.dispose();
    }
  });
});
