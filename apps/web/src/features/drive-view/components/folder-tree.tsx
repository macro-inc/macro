import { ViewSidebar } from '@app/components/view-shell';
import FolderIcon from '@phosphor/folder.svg';
import { For } from 'solid-js';
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
    <ul class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
      <For each={props.nodes}>
        {(node) => {
          const open = () =>
            props.searching || props.expandedIds.includes(node.id);
          return (
            <li class="min-w-0">
              <props.locationMenu location={{ kind: 'folder', id: node.id }}>
                <ViewSidebar.TreeItem
                  active={props.selectedId === node.id}
                  expanded={node.children.length > 0 ? open() : undefined}
                  label={node.name}
                  onToggle={() => props.onToggle(node.id)}
                  onClick={() => props.onSelect(node.id)}
                >
                  <ViewSidebar.Icon>
                    <FolderIcon class="size-4" />
                  </ViewSidebar.Icon>
                  <span class="truncate">{node.name}</span>
                </ViewSidebar.TreeItem>
              </props.locationMenu>
              <ViewSidebar.Branch open={open() && node.children.length > 0}>
                <FolderTree {...props} nodes={node.children} />
              </ViewSidebar.Branch>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
