import { ViewSidebar } from '@app/components/view-shell';
import { For, Show } from 'solid-js';
import type { TagTreeNode } from '../core/tag-tree';
import { TagDot } from '../TagDot';
import { BranchTagIcon } from './branch-tag-icon';

export function TagTree(props: {
  nodes: TagTreeNode[];
  activeIds: readonly string[];
  isExpanded: (node: TagTreeNode) => boolean;
  onToggle: (node: TagTreeNode) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <ul class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
      <For each={props.nodes}>
        {(node) => {
          const open = () => props.isExpanded(node);
          const active = () =>
            Boolean(node.tag && props.activeIds.includes(node.tag.id));
          return (
            <li class="min-w-0">
              <ViewSidebar.TreeItem
                active={active()}
                expanded={node.children.length > 0 ? open() : undefined}
                label={node.path}
                onToggle={() => props.onToggle(node)}
                onClick={() =>
                  node.tag ? props.onSelect(node.tag.id) : props.onToggle(node)
                }
              >
                <ViewSidebar.Icon>
                  <Show
                    when={node.children.length > 0}
                    fallback={<TagDot color={node.tag?.color} />}
                  >
                    <BranchTagIcon node={node} />
                  </Show>
                </ViewSidebar.Icon>
                <span class="truncate">{node.name}</span>
              </ViewSidebar.TreeItem>
              <ViewSidebar.Branch open={open() && node.children.length > 0}>
                <TagTree {...props} nodes={node.children} />
              </ViewSidebar.Branch>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
