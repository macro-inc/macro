import type { ElementDOMSlot } from './registry';
import type { NodeKey, ViewNode } from './types';

/** Keep the normal slot walk, but attach entirely new trees after assembly. */
export class NewSubtreeAttachments {
  private readonly unsafe = new Set<NodeKey>();
  private readonly pending: {
    parent: HTMLElement;
    before: () => Node | null;
    fragment: DocumentFragment;
  }[] = [];

  constructor(
    private readonly created: ReadonlySet<NodeKey>,
    getNode: (key: NodeKey) => ViewNode | null,
    private readonly getDOM: (key: NodeKey) => HTMLElement | undefined,
    canDetach: (node: ViewNode) => boolean
  ) {
    // A reused descendant must keep the ordinary move/reconciliation path.
    // Custom slot hooks can depend on connected layout. Keep those trees on
    // the ordinary path. Propagate each exclusion once, without ancestor rescans.
    for (const key of created) {
      const node = getNode(key);
      if (
        !node ||
        (canDetach(node) && !node.children.some((child) => !created.has(child)))
      )
        continue;
      let ancestor: NodeKey | null = key;
      while (
        ancestor !== null &&
        created.has(ancestor) &&
        !this.unsafe.has(ancestor)
      ) {
        this.unsafe.add(ancestor);
        ancestor = getNode(ancestor)?.parent ?? null;
      }
    }
  }

  private eligible(key: NodeKey): boolean {
    return this.created.has(key) && !this.unsafe.has(key);
  }

  /** Returns the first key after the deferred run, or leaves the ordinary path. */
  deferRun(
    slot: ElementDOMSlot,
    keys: readonly NodeKey[],
    start: number
  ): number | undefined {
    if (!slot.element.isConnected || !this.eligible(keys[start])) return;
    const first = this.getDOM(keys[start]);
    if (!first || first.isConnected) return;
    const fragment = slot.element.ownerDocument.createDocumentFragment();
    let end = start;
    for (; end < keys.length && this.eligible(keys[end]); end++) {
      const child = this.getDOM(keys[end]);
      if (!child) throw new Error('Missing child DOM: ' + keys[end]);
      if (child.isConnected) break;
      fragment.appendChild(child);
    }
    // The current old sibling may be removed by the ordinary cleanup. Anchor
    // to the next final model sibling (or slot boundary), after all moves.
    const sibling = end < keys.length ? this.getDOM(keys[end]) : null;
    if (sibling === undefined) throw new Error('Missing attachment anchor');
    // Managed insertion boundaries may retire during the remaining slot walk.
    // Read its getter at attachment, without reentering getDOMSlot hooks.
    const before = sibling ? () => sibling : () => slot.before ?? null;
    this.pending.push({ parent: slot.element, before, fragment });
    return end;
  }

  flush(): void {
    for (const { parent, before, fragment } of this.pending)
      parent.insertBefore(fragment, before());
    this.pending.length = 0;
  }
}
