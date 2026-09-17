import { ViewSidebar } from '@app/components/view-shell';
import CaretRightIcon from '@phosphor/caret-right.svg';
import FolderIcon from '@phosphor/folder.svg';
import { Button, cn } from '@ui';
import { For, Show } from 'solid-js';
import type { DriveFolderNode } from '../core/types';
import type { DriveLocationMenu } from './drive-navigation';

export function FolderTree(props: {
  nodes: DriveFolderNode[];
  selectedId?: string | null;
  expandedIds: string[];
  searching: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  locationMenu: DriveLocationMenu;
}) {
  return (
    <ul class="flex min-w-0 flex-col gap-0.5">
      <For each={props.nodes}>
        {(node) => {
          const open = () =>
            props.searching || props.expandedIds.includes(node.id);
          return (
            <li class="min-w-0">
              <props.locationMenu location={{ kind: 'folder', id: node.id }}>
                <div
                  class={cn(
                    'flex min-w-0 items-center rounded-xl',
                    props.selectedId === node.id
                      ? 'bg-active'
                      : 'hover:bg-hover'
                  )}
                >
                  <Show
                    when={node.children.length > 0}
                    fallback={<span class="w-6 shrink-0" />}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      square
                      class="size-6 shrink-0 rounded-lg not-disabled:hover:bg-transparent not-touch:not-disabled:hover:bg-none not-touch:not-disabled:active:bg-none"
                      aria-label={`${open() ? 'Collapse' : 'Expand'} ${node.name}`}
                      aria-expanded={open()}
                      onClick={() => props.onToggle(node.id)}
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
                      props.selectedId === node.id && 'text-ink'
                    )}
                    title={node.name}
                    aria-current={
                      props.selectedId === node.id ? 'page' : undefined
                    }
                    onClick={() => props.onSelect(node.id)}
                  >
                    <FolderIcon class="size-4 shrink-0" />
                    <span class="truncate">{node.name}</span>
                  </ViewSidebar.Item>
                </div>
              </props.locationMenu>
              <Show when={open() && node.children.length > 0}>
                <div class="ml-3 border-l border-edge pl-3">
                  <FolderTree {...props} nodes={node.children} />
                </div>
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
