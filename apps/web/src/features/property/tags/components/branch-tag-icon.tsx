import { TagDot } from '@ui';
import { createMemo } from 'solid-js';
import type { TagTreeNode } from '../core/tag-tree';
import { DEFAULT_TAG_COLOR } from '../tagColors';

/** Include the parent first so adding children never replaces its color. */
export function BranchTagIcon(props: { node: TagTreeNode }) {
  const fills = createMemo(() => {
    const colors: string[] = [];
    const visit = (node: TagTreeNode) => {
      if (node.tag) {
        const color = node.tag.color ?? DEFAULT_TAG_COLOR;
        colors.push(color);
      }
      node.children.forEach(visit);
    };
    visit(props.node);
    return colors;
  });

  return <TagDot fills={fills()} />;
}
