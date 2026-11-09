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
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
  type ElementDOMSlot,
  ElementNode,
  type NodeKey,
  ParagraphNode,
} from 'lexical';
import { describe, expect, test } from 'vitest';

describe('children fast path: contiguous-suffix incremental update', () => {
  function _createReconcilerEditor() {
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

  function $createBlockWrapperElementNode(): BlockWrapperElementNode {
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

  // AUDIT-5: when a wrapping ElementNode (keyed DOM != slot.element) is
  // the *parent* whose children mutate via the suffix size-delta fast
  // path, the helper's `$reconcileNode` / `$destroyNode` calls must
  // target `slot.element` (the actual DOM parent of the children), not
  // the outer keyed DOM where the text-content cache lives.
  //
  // Pre-fix, the helper received only `cacheDom` and routed it to both
  // roles. For wrapping parents the child's `parentNode` is the inner
  // slot, so `$destroyNode`'s `dom.parentNode === parentDOM` guard
  // failed silently and the orphan stayed in the DOM (size-delta=-1).
  // The `$reconcileNode` path's `parentDOM.replaceChild` would throw on
  // any `$updateDOM`-returning-true reconcile for the same reason.
  test('AUDIT-5: size-delta suffix routes DOM ops to slot.element on wrapping parents', () => {
    const editor = buildEditorFromExtensions(
      RichTextExtension,
      defineExtension({
        name: 'block-wrapper-audit',
        nodes: [BlockWrapperElementNode],
      })
    );
    editor.setRootElement(document.createElement('div'));

    try {
      // Cycle 1: wrapper with 4 paragraph children (>= MIN_FAST_PATH_CHILDREN).
      editor.update(
        () => {
          const root = $getRoot().clear();
          const wrapper = $createBlockWrapperElementNode();
          for (let i = 0; i < 4; i++) {
            wrapper.append(
              $createParagraphNode().append($createTextNode(`p${i}`))
            );
          }
          root.append(wrapper);
        },
        { discrete: true }
      );

      editor.read(() => {
        const wrapper = $getRoot().getFirstChildOrThrow();
        invariant($isElementNode(wrapper), 'wrapper');
        const outerDom = editor.getElementByKey(wrapper.__key)!;
        const innerSlot = outerDom.querySelector('section')!;
        expect(innerSlot.children.length).toBe(4);
        expect(outerDom.children.length).toBe(1);
      });

      // Cycle 2: append a 5th paragraph at the end (sizeDelta=+1, K=2).
      // The suffix size-delta helper fires; pre-fix this routed
      // $createNode through the helper's own $getDOMSlot call (still
      // correct), but in the mixed reconcile/create ops case the
      // $reconcileNode call would also fire with the wrong parent.
      editor.update(
        () => {
          const wrapper = $getRoot().getFirstChildOrThrow();
          invariant($isElementNode(wrapper), 'wrapper');
          wrapper.append($createParagraphNode().append($createTextNode('p4')));
        },
        { discrete: true }
      );

      editor.read(() => {
        const wrapper = $getRoot().getFirstChildOrThrow();
        invariant($isElementNode(wrapper), 'wrapper');
        const outerDom = editor.getElementByKey(wrapper.__key)!;
        const innerSlot = outerDom.querySelector('section')!;
        expect(innerSlot.children.length).toBe(5);
        expect(innerSlot.textContent).toBe('p0p1p2p3p4');
        expect(outerDom.children.length).toBe(1);
      });

      // Cycle 3: remove the last paragraph (sizeDelta=-1, K=1).
      // The destroy op fires. Pre-fix, $destroyNode(op.key, cacheDom)
      // was called with the outer `<div>`; the removed paragraph's
      // parentNode is the inner `<section>`, so the guard at
      // `dom.parentNode === parentDOM` failed silently — the
      // `<p>` stayed in the DOM as an unmapped orphan. Post-fix,
      // slot.element (= inner `<section>`) is passed; removeChild
      // succeeds and the DOM child count matches the node count.
      editor.update(
        () => {
          const wrapper = $getRoot().getFirstChildOrThrow();
          invariant($isElementNode(wrapper), 'wrapper');
          wrapper.getLastChildOrThrow().remove();
        },
        { discrete: true }
      );

      editor.read(() => {
        const wrapper = $getRoot().getFirstChildOrThrow();
        invariant($isElementNode(wrapper), 'wrapper');
        const outerDom = editor.getElementByKey(wrapper.__key)!;
        const innerSlot = outerDom.querySelector('section')!;
        expect(innerSlot.children.length).toBe(4);
        expect(innerSlot.textContent).toBe('p0p1p2p3');
        expect(outerDom.children.length).toBe(1);
      });
    } finally {
      editor.dispose();
    }
  });

  // AUDIT-5b: covers the `$reconcileNode` arm of the AUDIT-5 fix. The
  // AUDIT-5 test exercises only the `$destroyNode` path because
  // ParagraphNode's `updateDOM` returns false — `$reconcileNode`'s
  // `parentDOM.replaceChild` branch never fires there. Use a paragraph
  // subclass that forces `updateDOM` to return true so the replaceChild
  // path runs against a wrapping parent. Pre-fix this threw
  // `NotFoundError` because the outer wrapper is not the direct DOM
  // parent of the existing child.
  test('AUDIT-5b: size-delta suffix routes $reconcileNode replaceChild through slot.element on wrapping parents', () => {
    class RerenderParagraphNode extends ParagraphNode {
      $config() {
        return this.config('audit_rerender_paragraph', {
          extends: ParagraphNode,
        });
      }
      updateDOM(): boolean {
        return true;
      }
    }
    function $createRerenderParagraphNode(): RerenderParagraphNode {
      return $applyNodeReplacement(new RerenderParagraphNode());
    }

    const editor = buildEditorFromExtensions(
      RichTextExtension,
      defineExtension({
        name: 'block-wrapper-audit-b',
        nodes: [BlockWrapperElementNode, RerenderParagraphNode],
      })
    );
    editor.setRootElement(document.createElement('div'));

    try {
      const plainParaKeys: NodeKey[] = [];
      let rerenderKey: NodeKey = '';

      // Cycle 1: wrapper with 3 plain paragraphs + 1 RerenderParagraph
      // at the end. Size 4 hits MIN_FAST_PATH_CHILDREN.
      editor.update(
        () => {
          const root = $getRoot().clear();
          const wrapper = $createBlockWrapperElementNode();
          for (let i = 0; i < 3; i++) {
            const p = $createParagraphNode().append($createTextNode(`p${i}`));
            wrapper.append(p);
            plainParaKeys.push(p.__key);
          }
          const rN = $createRerenderParagraphNode().append(
            $createTextNode('pR')
          );
          wrapper.append(rN);
          rerenderKey = rN.__key;
          root.append(wrapper);
        },
        { discrete: true }
      );

      // Snapshot the post-cycle-1 DOMs. The reconciler must preserve
      // identity for the non-dirty prefix children across cycle 2; only
      // the reconciled RerenderParagraph gets a fresh DOM via
      // replaceChild. Pre-fix the replaceChild fails (parentDOM mismatch
      // in jsdom throws a `DOMException`, which Lexical recovers from
      // via `resetEditor` + `FULL_RECONCILE` — rebuilding every child
      // DOM from scratch, so the plain prefix loses identity.
      const plainPreDoms = plainParaKeys.map(
        (k) => editor.getElementByKey(k) as HTMLElement | null
      );
      const rerenderPreDom = editor.getElementByKey(
        rerenderKey
      ) as HTMLElement | null;

      // Cycle 2: append a 5th plain paragraph. sizeDelta=+1, K=2 — the
      // helper's ops are [reconcile RerenderParagraph, create newP]. The
      // reconcile takes the replaceChild branch via $updateDOM=true.
      editor.update(
        () => {
          const wrapper = $getRoot().getFirstChildOrThrow();
          invariant($isElementNode(wrapper), 'wrapper');
          wrapper.append(
            $createParagraphNode().append($createTextNode('pNew'))
          );
        },
        { discrete: true }
      );

      editor.read(() => {
        const wrapper = $getRoot().getFirstChildOrThrow();
        invariant($isElementNode(wrapper), 'wrapper');
        const outerDom = editor.getElementByKey(wrapper.__key)!;
        const innerSlot = outerDom.querySelector('section')!;

        // DOM shape stays correct after cycle 2 even pre-fix because
        // Lexical recovers from the throw with a full re-render. The
        // load-bearing assertion is below — identity survival of the
        // non-dirty prefix.
        expect(innerSlot.children.length).toBe(5);
        expect(innerSlot.textContent).toBe('p0p1p2pRpNew');
        expect(outerDom.children.length).toBe(1);

        // Identity survival: the plain prefix children are non-dirty in
        // cycle 2; the reconciler must keep their DOMs intact. Pre-fix,
        // the recovery path creates fresh DOMs for every child — these
        // identity comparisons fail.
        for (let i = 0; i < plainParaKeys.length; i++) {
          const post = editor.getElementByKey(plainParaKeys[i]);
          expect(post).toBe(plainPreDoms[i]);
        }

        // The RerenderParagraph went through replaceChild — its DOM
        // identity must differ from cycle 1's. Pre-fix recovery also
        // gives a new DOM, so this single assertion alone wouldn't
        // discriminate; paired with the prefix-identity check above it
        // confirms the targeted-replace happened rather than the
        // full-rebuild fallback.
        const postRerender = editor.getElementByKey(rerenderKey);
        expect(postRerender).not.toBe(rerenderPreDom);
      });
    } finally {
      editor.dispose();
    }
  });

  // AUDIT-6: same-size suffix newSuffix builder must read each
  // reconciled child's cache from the CURRENT keyed-DOM map, not the
  // prev-state snapshot. When a dirty child's `$updateDOM` returns
  // true, `$reconcileNode`'s `parentDOM.replaceChild` detaches the old
  // DOM and stores a new one in `_keyToDOMMap`. The prev snapshot
  // still points at the detached old DOM whose `__lexicalTextContent`
  // is the previous cycle's text — stale. Reading from the prev map
  // (pre-fix) writes a stale value into the parent's
  // `__lexicalTextContent`, which then propagates up the cache chain.
  test('AUDIT-6: same-size suffix reads current-state cache after $updateDOM=true', () => {
    class RerenderParagraphNode extends ParagraphNode {
      $config() {
        return this.config('audit_rerender_paragraph_same_size', {
          extends: ParagraphNode,
        });
      }
      updateDOM(): boolean {
        return true;
      }
    }
    function $createRerenderParagraphNode(): RerenderParagraphNode {
      return $applyNodeReplacement(new RerenderParagraphNode());
    }

    const editor = buildEditorFromExtensions(
      RichTextExtension,
      defineExtension({
        name: 'same-size-rerender-audit',
        nodes: [RerenderParagraphNode],
      })
    );
    editor.setRootElement(document.createElement('div'));

    try {
      let rN1Key: NodeKey = '';
      let rN2Key: NodeKey = '';

      // Cycle 1: root has 4 block children — 2 plain paragraphs + 2
      // RerenderParagraphs as the contiguous suffix. Size 4 hits
      // MIN_FAST_PATH_CHILDREN.
      editor.update(
        () => {
          const root = $getRoot().clear();
          root.append(
            $createParagraphNode().append($createTextNode('p0')),
            $createParagraphNode().append($createTextNode('p1'))
          );
          const rN1 = $createRerenderParagraphNode().append(
            $createTextNode('pR1')
          );
          const rN2 = $createRerenderParagraphNode().append(
            $createTextNode('pR2')
          );
          root.append(rN1, rN2);
          rN1Key = rN1.__key;
          rN2Key = rN2.__key;
        },
        { discrete: true }
      );

      // Cycle 2: mutate text in both RerenderParagraphs. sizeDelta=0,
      // K=2 contiguous suffix → same-size suffix path fires. Both
      // children's `$updateDOM` returns true → replaceChild swaps each
      // DOM in `_keyToDOMMap`. The prev snapshot still references the
      // old detached DOMs whose cached `__lexicalTextContent` is from
      // cycle 1 ("pR1", "pR2"). Reading from the prev map would
      // produce a stale parent cache.
      editor.update(
        () => {
          const rN1 = $getNodeByKey(rN1Key);
          const rN2 = $getNodeByKey(rN2Key);
          invariant(
            $isElementNode(rN1) && $isElementNode(rN2),
            'rN1/rN2 are elements'
          );
          const t1 = rN1.getFirstChildOrThrow();
          const t2 = rN2.getFirstChildOrThrow();
          invariant($isTextNode(t1) && $isTextNode(t2), 'texts');
          t1.setTextContent('NEW_R1');
          t2.setTextContent('NEW_R2');
        },
        { discrete: true }
      );

      editor.read(() => {
        const root = $getRoot();
        const expected = ['p0', 'p1', 'NEW_R1', 'NEW_R2'].join('\n\n');
        expect(root.getTextContent()).toBe(expected);
        const rootDom = editor.getElementByKey(root.__key) as
          | (HTMLElement & { __lexicalTextContent?: string })
          | null;
        // The load-bearing check: pre-fix, this returns the stale
        // 'p0\n\np1\n\npR1\n\npR2' string because the newSuffix builder
        // read each reconciled child's `__lexicalTextContent` off the
        // detached prev-state DOM.
        expect(rootDom?.__lexicalTextContent).toBe(expected);
      });
    } finally {
      editor.dispose();
    }
  });

  // AUDIT-7: the suffix size-delta helper hardcodes expectedK = 2 for
  // sizeDelta=+1 and 1 for sizeDelta=-1, bailing on anything else.
  // This test sets up a K=3 contiguous suffix with sizeDelta=+1 so the
  // K check at line 724 fires, the helper bails, and the general path
  // rebuilds the cache. The test pins the OUTPUT (`__lexicalTextContent`
  // matches the walked text) — note that the helper's splice math
  // happens to also produce the correct output for this specific
  // K=3/sizeDelta=+1 case (since `kPrime = k - sizeDelta = 2`), so if
  // the K check were ever loosened to allow K=3 through, this test
  // wouldn't fail. The output sentinel still catches a broken splice
  // (e.g. wrong `oldSuffixLength`, off-by-one boundary).
  test('AUDIT-7: K=3 contiguous suffix with sizeDelta=+1 — output sentinel after helper bail', () => {
    const editor = buildEditorFromExtensions(RichTextExtension);
    editor.setRootElement(document.createElement('div'));

    try {
      let paraCKey: NodeKey | null = null;
      let paraDKey: NodeKey | null = null;
      editor.update(
        () => {
          const root = $getRoot().clear();
          const labels = ['pA', 'pB', 'pC', 'pD'];
          for (const label of labels) {
            const p = $createParagraphNode();
            p.append($createTextNode(label));
            root.append(p);
            if (label === 'pC') {
              paraCKey = p.__key;
            } else if (label === 'pD') {
              paraDKey = p.__key;
            }
          }
        },
        { discrete: true }
      );

      // Mutate pC and pD (contiguous suffix), append pE. Dirty set:
      // {pC, pD, pE} forms a K=3 contiguous suffix of the next state.
      // sizeDelta=+1, expectedK=2 → helper bails at the K check (line
      // 724), caller falls through to $reconcileNodeChildren.
      editor.update(
        () => {
          invariant(paraCKey !== null && paraDKey !== null, 'keys set');
          const paraC = $getNodeByKey(paraCKey);
          const paraD = $getNodeByKey(paraDKey);
          invariant(
            $isParagraphNode(paraC) && $isParagraphNode(paraD),
            'paraC/paraD are paragraphs'
          );
          const tC = paraC.getFirstChildOrThrow();
          const tD = paraD.getFirstChildOrThrow();
          invariant($isTextNode(tC) && $isTextNode(tD), 'texts');
          tC.setTextContent('CHANGED_C');
          tD.setTextContent('CHANGED_D');
          const root = $getRoot();
          root.append($createParagraphNode().append($createTextNode('pE')));
        },
        { discrete: true }
      );

      editor.read(() => {
        const root = $getRoot();
        const expected = ['pA', 'pB', 'CHANGED_C', 'CHANGED_D', 'pE'].join(
          '\n\n'
        );
        expect(root.getTextContent()).toBe(expected);
        const rootDom = editor.getElementByKey(root.__key) as
          | (HTMLElement & { __lexicalTextContent?: string })
          | null;
        // Cached parent text must match the freshly computed text. If
        // the K check were ever loosened to let K=3 through the helper
        // with the current splice math (which assumes expectedK=2),
        // `__lexicalTextContent` here would diverge from the walked
        // value.
        expect(rootDom?.__lexicalTextContent).toBe(expected);
      });
    } finally {
      editor.dispose();
    }
  });
});
