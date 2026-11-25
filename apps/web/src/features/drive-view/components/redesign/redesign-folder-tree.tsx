import { ViewSidebar } from '@app/components/view-shell';
import type { CreateFolderDropTarget } from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import { createEntityDraggable, type ProjectEntity } from '@entity';
import FolderIcon from '@icon/system/regular/folder.svg';
import FolderOpenIcon from '@icon/system/regular/folder-open.svg';
import FolderSimpleUserIcon from '@icon/system/regular/folder-simple-user.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { cn, Tooltip } from '@ui';
import { createEffect, For, onCleanup, Show } from 'solid-js';
import type { DriveFolderMetadata } from '../../context/drive-source';
import type { DriveFolderNode } from '../../core/types';
import type { DriveLocationMenu } from '../drive-navigation';
import { InlineNameInput } from './inline-name-input';

const SPRING_LOAD_DELAY_MS = 550;

type RedesignFolderTreeProps = {
  nodes: DriveFolderNode[];
  foldersById: ReadonlyMap<string, DriveFolderMetadata>;
  subfolderCounts: ReadonlyMap<string, number>;
  selectedId?: string | null;
  expandedIds: string[];
  searching: boolean;
  sharedSection?: boolean;
  userId?: string;
  splitId?: string;
  locationMenu: DriveLocationMenu;
  createDropTarget?: CreateFolderDropTarget;
  renamingId?: string;
  creatingParentId?: string | null | undefined;
  inlinePending?: boolean;
  onToggle: (id: string) => void;
  onExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onStartCreateSubfolder?: (parentId: string) => void;
  onCommitRename: (id: string, nextName: string) => Promise<void> | void;
  onCancelRename: () => void;
  onCommitCreateFolder: (
    parentId: string | null,
    name: string
  ) => Promise<void> | void;
  onCancelCreateFolder: () => void;
};

function FolderTreeNodeRow(props: {
  node: DriveFolderNode;
  tree: RedesignFolderTreeProps;
}) {
  const open = () =>
    props.tree.searching || props.tree.expandedIds.includes(props.node.id);
  const metadata = () => props.tree.foldersById.get(props.node.id);
  const isOwned = () =>
    !props.tree.userId || metadata()?.userId === props.tree.userId;
  const childCount = () => props.tree.subfolderCounts.get(props.node.id) ?? 0;
  const isCreatingChildHere = () =>
    props.tree.creatingParentId === props.node.id;

  const dropTarget = props.tree.createDropTarget?.(() => props.node.id);

  // Spring-loaded folder auto-expand: hovering a dragged item over a collapsed
  // parent folder for 550ms opens its children so you can drop deeper cleanly.
  createEffect(() => {
    const hovering = dropTarget?.isOver() ?? false;
    if (!hovering || props.node.children.length === 0 || open()) return;
    const timer = window.setTimeout(() => {
      props.tree.onExpand(props.node.id);
    }, SPRING_LOAD_DELAY_MS);
    onCleanup(() => window.clearTimeout(timer));
  });

  const dragEntity = (): ProjectEntity => ({
    type: 'project',
    id: props.node.id,
    name: props.node.name,
    ownerId: metadata()?.userId ?? props.tree.userId ?? '',
    projectId: props.node.parentId ?? undefined,
  });

  const attachDrag = createEntityDraggable({
    get entity() {
      return dragEntity();
    },
    splitId: props.tree.splitId,
    instanceKey: 'sidebar-tree',
  });

  const isSelected = () => props.tree.selectedId === props.node.id;

  return (
    <li class="min-w-0">
      <Show
        when={props.tree.renamingId === props.node.id}
        fallback={
          <props.tree.locationMenu
            location={{ kind: 'folder', id: props.node.id }}
          >
            <div
              ref={(element) => {
                dropTarget?.ref(element);
                if (isOwned()) attachDrag(element);
              }}
              class={cn(
                'group/folder-row relative rounded-lg transition-colors',
                dropTarget?.isOver() &&
                  'bg-accent/12 outline-2 -outline-offset-2 outline-accent'
              )}
            >
              <ViewSidebar.TreeItem
                active={isSelected()}
                expanded={
                  props.node.children.length > 0 || isCreatingChildHere()
                    ? open() || isCreatingChildHere()
                    : undefined
                }
                label={props.node.name}
                onToggle={() => props.tree.onToggle(props.node.id)}
                onClick={() => props.tree.onSelect(props.node.id)}
              >
                <ViewSidebar.Icon>
                  <Show
                    when={props.tree.sharedSection}
                    fallback={
                      <Show
                        when={open() && props.node.children.length > 0}
                        fallback={<FolderIcon class="size-4" />}
                      >
                        <FolderOpenIcon class="size-4" />
                      </Show>
                    }
                  >
                    <FolderSimpleUserIcon class="size-4" />
                  </Show>
                </ViewSidebar.Icon>
                <span class="min-w-0 flex-1 truncate">{props.node.name}</span>
                <Show when={childCount() > 0 && !open()}>
                  <span class="shrink-0 text-[11px] tabular-nums text-ink-subtle group-hover/folder-row:hidden">
                    {childCount()}
                  </span>
                </Show>
              </ViewSidebar.TreeItem>
              <Show
                when={isOwned() ? props.tree.onStartCreateSubfolder : undefined}
              >
                {(startCreate) => (
                  <div
                    class={cn(
                      'pointer-events-none absolute inset-y-0 flex items-center opacity-0 transition-opacity group-hover/folder-row:pointer-events-auto group-hover/folder-row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
                      props.node.children.length > 0 ? 'right-7' : 'right-1'
                    )}
                  >
                    <Tooltip
                      label={t('drive.newSubfolderIn', {
                        name: props.node.name,
                      })}
                    >
                      <button
                        type="button"
                        aria-label={t('drive.newSubfolderIn', {
                          name: props.node.name,
                        })}
                        class="inline-flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.tree.onExpand(props.node.id);
                          startCreate()(props.node.id);
                        }}
                      >
                        <PlusIcon class="size-3.5" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </div>
                )}
              </Show>
            </div>
          </props.tree.locationMenu>
        }
      >
        <div class="flex h-(--sidebar-row-height) items-center gap-1.5 px-2">
          <FolderIcon class="size-4 shrink-0 text-ink-muted" />
          <InlineNameInput
            initialValue={props.node.name}
            isFolder
            ariaLabel={t('drive.renameInputLabel', { name: props.node.name })}
            disabled={props.tree.inlinePending}
            onCommit={(nextName) =>
              props.tree.onCommitRename(props.node.id, nextName)
            }
            onCancel={props.tree.onCancelRename}
          />
        </div>
      </Show>
      <ViewSidebar.Branch
        open={
          (open() && props.node.children.length > 0) || isCreatingChildHere()
        }
      >
        <Show when={isCreatingChildHere()}>
          <div class="mb-0.5 flex h-(--sidebar-row-height) items-center gap-1.5 px-2">
            <FolderIcon class="size-4 shrink-0 text-accent" />
            <InlineNameInput
              initialValue=""
              isFolder
              placeholder={t('drive.folderNamePlaceholder')}
              ariaLabel={t('drive.newFolderInputLabel')}
              disabled={props.tree.inlinePending}
              onCommit={(name) =>
                props.tree.onCommitCreateFolder(props.node.id, name)
              }
              onCancel={props.tree.onCancelCreateFolder}
            />
          </div>
        </Show>
        <Show when={props.node.children.length > 0}>
          <RedesignFolderTree {...props.tree} nodes={props.node.children} />
        </Show>
      </ViewSidebar.Branch>
    </li>
  );
}

/**
 * Upgraded Notion + Finder folder tree for Drive's sidebar: supports
 * drag-reparenting owned folders, spring-loaded drop auto-expand, inline
 * subfolder creation, inline rename, and subfolder count indicators.
 */
export function RedesignFolderTree(props: RedesignFolderTreeProps) {
  return (
    <ul class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
      <For each={props.nodes}>
        {(node) => <FolderTreeNodeRow node={node} tree={props} />}
      </For>
    </ul>
  );
}
