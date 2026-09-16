import { ViewSidebar } from '@app/components/view-shell';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { Button, cn } from '@ui';
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
    <ul class="flex min-w-0 flex-col gap-0.5">
      <For each={props.nodes}>
        {(node) => {
          const open = () => props.isExpanded(node);
          const active = () =>
            Boolean(node.tag && props.activeIds.includes(node.tag.id));
          return (
            <li class="min-w-0">
              <div
                class={cn(
                  'flex min-w-0 items-center rounded-xl',
                  active() ? 'bg-active' : 'hover:bg-hover'
                )}
              >
                <Show
                  when={node.children.length > 0}
                  fallback={<span class="w-6 shrink-0" />}
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="size-6 shrink-0 rounded-lg not-disabled:hover:bg-transparent not-touch:not-disabled:hover:bg-none not-touch:not-disabled:active:bg-none"
                    aria-label={`${open() ? 'Collapse' : 'Expand'} ${node.path}`}
                    aria-expanded={open()}
                    onClick={() => props.onToggle(node)}
                  >
                    <CaretRightIcon
                      class={cn(
                        'size-3 transition-transform',
                        open() && 'rotate-90'
                      )}
                    />
                  </Button>
                </Show>
                <ViewSidebar.Item
                  class={cn(
                    'min-w-0 flex-1 justify-start px-2 font-normal bg-transparent not-disabled:hover:bg-transparent not-touch:not-disabled:hover:bg-none not-touch:not-disabled:active:bg-none',
                    active() && 'text-ink'
                  )}
                  title={node.path}
                  aria-current={active() ? 'page' : undefined}
                  aria-expanded={!node.tag ? open() : undefined}
                  onClick={() =>
                    node.tag
                      ? props.onSelect(node.tag.id)
                      : props.onToggle(node)
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
                </ViewSidebar.Item>
              </div>
              <Show when={open() && node.children.length > 0}>
                <div class="ml-3 border-l border-edge pl-3">
                  <TagTree {...props} nodes={node.children} />
                </div>
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
