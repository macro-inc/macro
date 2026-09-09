import CaretRightIcon from '@phosphor/caret-right.svg';
import FolderIcon from '@phosphor/folder.svg';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import type { FolderNode } from './folder-tree';

export function DriveFolderTree(props: {
  nodes: FolderNode[];
  selected?: string;
  rootActive?: boolean;
  onSelect: (id?: string) => void;
}) {
  const rowClass = (id?: string) =>
    cn(
      'flex h-9 min-w-0 items-center gap-2 rounded-lg px-2 text-sm text-ink-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
      (id ? props.selected === id : props.rootActive) && 'bg-active text-ink'
    );
  const Branch = (p: { node: FolderNode }) => (
    <li>
      <Show
        when={p.node.children.length}
        fallback={
          <button
            type="button"
            class={cn(rowClass(p.node.folder.id), 'w-full pl-7')}
            aria-current={
              props.selected === p.node.folder.id ? 'page' : undefined
            }
            onClick={() => props.onSelect(p.node.folder.id)}
          >
            <FolderIcon class="size-4 shrink-0" />
            <span class="truncate">{p.node.folder.name}</span>
          </button>
        }
      >
        <details class="[&[open]>summary>svg:first-child]:rotate-90">
          <summary
            class={cn(
              rowClass(p.node.folder.id),
              'list-none [&::-webkit-details-marker]:hidden'
            )}
            onClick={() => props.onSelect(p.node.folder.id)}
          >
            <CaretRightIcon class="size-3 shrink-0" />
            <FolderIcon class="size-4 shrink-0" />
            <span class="truncate">{p.node.folder.name}</span>
          </summary>
          <ul class="ml-3 border-l border-edge-muted pl-2">
            <For each={p.node.children}>{(node) => <Branch node={node} />}</For>
          </ul>
        </details>
      </Show>
    </li>
  );
  return (
    <nav aria-label="Folder tree">
      <details open class="group/root">
        <summary
          class={cn(rowClass(), 'list-none [&::-webkit-details-marker]:hidden')}
          onClick={() => props.onSelect()}
        >
          <CaretRightIcon class="size-3 shrink-0 group-open/root:rotate-90" />
          <FolderIcon class="size-4 shrink-0" />
          <span>Drive</span>
        </summary>
        <ul class="ml-3 border-l border-edge-muted pl-2">
          <For each={props.nodes}>{(node) => <Branch node={node} />}</For>
        </ul>
      </details>
    </nav>
  );
}
