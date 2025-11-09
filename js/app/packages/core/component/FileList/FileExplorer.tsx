import type { FileListSize } from '@core/component/FileList/constants';
import type { FileTree } from '@core/component/FileList/fileTree';
import { ListViewItem } from '@core/component/FileList/ListViewItem';
import type { ViewType } from '@core/component/FileList/viewTypes';
import { observedSize } from '@core/directive/observedSize';
import { type SortPair, sortItems } from '@core/util/sort';
import TrashIcon from '@icon/regular/trash.svg?component-solid';
import FolderDashed from '@phosphor-icons/core/regular/folder-dashed.svg?component-solid';
import MagnifyingGlass from '@phosphor-icons/core/regular/magnifying-glass.svg?component-solid';
// import { GridView } from './GridView';
import type { ItemType } from '@service-storage/client';
import { useDeletedTree } from '@service-storage/deleted';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import type { Item } from '@service-storage/generated/schemas/item';
import type { Project } from '@service-storage/generated/schemas/project';
import { usePinnedIds } from '@service-storage/pins';
import { useCreateProject } from '@service-storage/projects';
import { refetchResources } from '@service-storage/util/refetchResources';
import { createDroppable } from '@thisbeyond/solid-dnd';
import { CreateNewItemButton } from 'core/component/FileList/CreateNewItemButton';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  Match,
  on,
  type Setter,
  Show,
  Switch,
} from 'solid-js';
import type { SetStoreFunction, Store } from 'solid-js/store';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { NewProjectItem } from './NewProjectItem';

false && observedSize;

function EmptyState(props: { isFiltered: boolean }) {
  return (
    <div class="flex-1 w-full h-full flex flex-col items-center justify-center gap-3 text-ink-muted">
      <Switch>
        <Match when={props.isFiltered}>
          <MagnifyingGlass class="w-8 h-8" />
          <span class="text-sm">No matching items found</span>
        </Match>
        <Match when={!props.isFiltered}>
          <FolderDashed class="w-8 h-8" />
          <span class="text-sm">No files in this project</span>
        </Match>
      </Switch>
    </div>
  );
}

export type FileExplorerProps = {
  size: FileListSize;
  viewType: ViewType;
  parentId?: string;
  parentName?: string;
  currentFileTree: Accessor<FileTree>;
  selectedItems: Accessor<Item[]>;
  setSelectedItems: Setter<Item[]>;
  selectableTypes?: ItemType[];
  fileSort: Accessor<SortPair>;
  expandedProjectsStore: [
    Store<{ [key: string]: boolean }>,
    SetStoreFunction<{ [key: string]: boolean }>,
  ];
  hasSearchOrFilter: boolean;
  showProjectsFirst: boolean;
  showTrash?: boolean;
  hideOwner?: boolean;
  hideDate?: boolean;
  hideAction?: boolean;
  height?: number;
  openItemsInSplit?: boolean;
  insideProjectBlock?: boolean;
  selectionOnly?: boolean;
  setBlockProject?: (project: Project) => void;
  savedScrollOffset?: Accessor<number>;
  setSavedScrollOffset?: Setter<number>;
  scrollOffsetTriggerSignal?: Accessor<any>;
  scrollOffsetRestoreValue?: any;
};

export function FileExplorer(props: FileExplorerProps) {
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();
  const [size, setSize] = createSignal<DOMRect>();
  const [isCreatingProject, setIsCreatingProject] = createSignal(false);

  const rootItems = createMemo(() => {
    switch (props.parentId) {
      case '':
      case 'root':
      case undefined: {
        const trash = {
          id: 'trash',
          name: 'Trash',
          type: 'project',
          userId: '',
          updatedAt: 0,
          createdAt: 0,
          parentId: '',
        } as Item;
        return props.showTrash
          ? [
              ...props.currentFileTree().rootItems.map((item) => item.item),
              trash,
            ]
          : props.currentFileTree().rootItems.map((item) => item.item);
      }
      case 'trash':
        return props.currentFileTree().rootItems.map((item) => item.item);
      default:
        return props.currentFileTree().itemMap[props.parentId!]?.children;
    }
  });

  const pinnedIds = usePinnedIds();
  const isPinned = createSelector(pinnedIds, (id: string, pinnedIds) =>
    pinnedIds.includes(id)
  );

  const sortedItemsToDisplay = createMemo(() => {
    const [sortType, sortDirection] = props.fileSort();
    const currentPinnedIds = pinnedIds();
    const items = rootItems() || []; // Add default empty array if children() is undefined

    // Separate trash item from other items
    const trashItem = items.find((item) => item.id === 'trash');
    const otherItems = items.filter((item) => item.id !== 'trash');

    const sortedItems = [...otherItems].sort((a, b) => {
      const aIsPinned = currentPinnedIds.includes(a.id);
      const bIsPinned = currentPinnedIds.includes(b.id);

      // If both items are pinned, sort by pin index
      if (aIsPinned && bIsPinned) {
        const aIndex = currentPinnedIds.indexOf(a.id);
        const bIndex = currentPinnedIds.indexOf(b.id);
        return aIndex - bIndex;
      }

      // If only one item is pinned, it goes first
      if (aIsPinned) return -1;
      if (bIsPinned) return 1;

      // Otherwise sort by sortType and sortDirection
      return sortItems(a, b, sortType, sortDirection, {
        showProjectsFirst: props.showProjectsFirst
          ? props.showProjectsFirst
          : undefined,
      });
    });

    if (trashItem) {
      sortedItems.unshift(trashItem);
    }

    return sortedItems;
  });

  let droppableRef: HTMLDivElement | undefined;
  const [droppable, setDroppable] = createSignal(
    createDroppable('explorer-base-' + props.parentId, {
      type: 'explorer-base',
      parentId: props.parentId,
      parentName: props.parentName,
    })
  );

  createEffect(() => {
    if (droppableRef) {
      const newDroppable = createDroppable('explorer-base-' + props.parentId, {
        type: 'explorer-base',
        parentId: props.parentId,
        parentName: props.parentName,
      });
      setDroppable(() => newDroppable);
      newDroppable(droppableRef);
    }
  });

  const createProject = useCreateProject();
  async function createNewProject(name: string, parentId?: string) {
    createProject({
      name,
      parentId,
    });
    setIsCreatingProject(false);
    refetchResources();
  }

  // Restore scroll position when entering email view
  if (
    props.scrollOffsetTriggerSignal &&
    props.savedScrollOffset &&
    props.scrollOffsetRestoreValue
  ) {
    createEffect(
      on(
        () => props.scrollOffsetTriggerSignal?.(),
        () => {
          const restoreTrigger =
            props.scrollOffsetTriggerSignal?.() ===
            props.scrollOffsetRestoreValue;
          const handle = virtualHandle();
          const savedOffset = props.savedScrollOffset?.();

          if (
            restoreTrigger &&
            handle &&
            savedOffset !== undefined &&
            savedOffset > 0
          ) {
            setTimeout(() => {
              const currentHandle = virtualHandle();
              if (currentHandle) {
                currentHandle.scrollTo(savedOffset);
              }
            }, 0);
          }
        }
      )
    );
  }

  return (
    <div
      ref={droppableRef}
      class={`${droppable().isActiveDroppable ? 'rootDrop' : ''} flex-1 flex flex-col`}
      use:droppable={droppable()}
    >
      <Switch>
        <Match
          when={props.viewType === 'flatList' || props.viewType === 'treeList'}
        >
          <Show when={props.parentId !== 'trash' && !props.selectionOnly}>
            <CreateNewItemButton
              parentId={props.parentId === 'root' ? '' : props.parentId}
              setIsCreatingProject={setIsCreatingProject}
              size={props.size}
              insideProjectBlock={props.insideProjectBlock ?? false}
            />
          </Show>
          <Show when={isCreatingProject()}>
            <NewProjectItem
              size={props.size}
              onSubmitEdit={(name) => createNewProject(name, props.parentId)}
              onCancelEdit={() => setIsCreatingProject(false)}
              depth={0}
              hideOwner={props.hideOwner}
              hideDate={props.hideDate}
              hideAction={props.hideAction}
            />
          </Show>
          <Show
            when={sortedItemsToDisplay().length > 0}
            fallback={<EmptyState isFiltered={props.hasSearchOrFilter} />}
          >
            <style>
              {`
                .explorer-level-root:has(.explorer-child-0), .rootDrop .explorer-level-root {
                  --tw-ring-inset: inset;
                  --tw-ring-offset-width: 2px;
                  --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor);
                  box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
                  --tw-ring-color: var(--color-blue-200);
                }`}
            </style>
            <div
              class="flex-1 rounded-lg explorer-level-root"
              use:observedSize={{ setSize: setSize }}
              onKeyDown={(e) => {
                const navWrappers = [
                  ...e.currentTarget.querySelectorAll('a[data-nav-id]'),
                ] as HTMLElement[];
                console.log(e.key, e.currentTarget);
                if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;

                // const index = navWrappers.findIndex(el => el.getAttribute('tabindex') === '0')
                const index = document.activeElement
                  ? navWrappers.indexOf(document.activeElement as HTMLElement)
                  : -1;
                if (index === -1) {
                  const navWrapper = navWrappers[0];
                  // navWrapper.setAttribute('tabindex', '0')
                  navWrapper.focus();
                  return;
                }
                if (e.key === 'ArrowDown') {
                  // focusedNavWrapper()?.setAttribute('tabindex', '-1')
                  const navWrapper = navWrappers[index + 1] ?? navWrappers[0];
                  // navWrapper.setAttribute('tabindex', '0')
                  navWrapper.focus();
                }
                if (e.key === 'ArrowUp') {
                  // focusedNavWrapper()?.setAttribute('tabindex', '-1')
                  const navWrapper =
                    navWrappers[index - 1] ?? navWrappers.at(-1);
                  // navWrapper.setAttribute('tabindex', '0')
                  navWrapper.focus();
                }
              }}
            >
              <VList
                data={sortedItemsToDisplay()}
                ref={setVirtualHandle}
                onScrollEnd={() => {
                  const handle = virtualHandle();
                  if (props.setSavedScrollOffset && handle) {
                    props.setSavedScrollOffset(handle.scrollOffset);
                  }
                }}
                class="flex-1"
                style={{
                  height: `${props.height ?? size()?.height}px`,
                }}
                overscan={10}
              >
                {(item: Item) => {
                  if (item.id === 'trash') {
                    const deletedTree = useDeletedTree();
                    const deletedRootItems = deletedTree().rootItems.map(
                      (item) => item.item
                    );
                    return (
                      <ListViewItem
                        itemType={'project'}
                        childItems={deletedRootItems}
                        id={'trash'}
                        name={'Trash'}
                        owner={''}
                        updatedAt={0}
                        createdAt={0}
                        size={props.size}
                        viewType={props.viewType}
                        depth={0}
                        selectedItems={props.selectedItems}
                        setSelectedItems={props.setSelectedItems}
                        customIconComponent={TrashIcon}
                        expandedProjectsStore={props.expandedProjectsStore}
                        currentFileTree={deletedTree()}
                        fileSort={props.fileSort}
                        showProjectsFirst={props.showProjectsFirst}
                        hideOwner
                        hideDate
                        hideAction
                        openItemsInSplit={props.openItemsInSplit}
                      />
                    );
                  }
                  const childItems = createMemo(() => {
                    return item.type === 'project'
                      ? props.currentFileTree().itemMap[item.id]?.children
                      : undefined;
                  });
                  if (item.type === 'chat' && item.isPersistent) {
                    // cireix
                    return '';
                  }
                  return (
                    <ListViewItem
                      id={item.id}
                      itemType={item.type}
                      fileType={
                        item.type === 'document'
                          ? (item.fileType as FileType)
                          : undefined
                      }
                      name={item.name}
                      pinned={isPinned(item.id)}
                      pinIndex={pinnedIds().indexOf(item.id)}
                      updatedAt={item.updatedAt}
                      createdAt={item.createdAt}
                      parentId={
                        item.type === 'project'
                          ? (item.parentId ?? undefined)
                          : (item.projectId ?? undefined)
                      }
                      childItems={childItems()}
                      owner={
                        item.type === 'document' ? item.owner : item.userId
                      }
                      size={props.size}
                      viewType={props.viewType}
                      depth={props.viewType === 'treeList' ? 0 : undefined}
                      selectableTypes={props.selectableTypes}
                      selectedItems={props.selectedItems}
                      setSelectedItems={props.setSelectedItems}
                      expandedProjectsStore={props.expandedProjectsStore}
                      currentFileTree={props.currentFileTree()}
                      fileSort={props.fileSort}
                      showProjectsFirst={props.showProjectsFirst}
                      hideOwner={props.hideOwner}
                      hideDate={props.hideDate}
                      hideAction={props.hideAction}
                      openItemsInSplit={props.openItemsInSplit}
                      setBlockProject={props.setBlockProject}
                      insideProjectBlock={props.insideProjectBlock}
                      fileExplorerParentId={props.parentId}
                      selectionOnly={props.selectionOnly}
                    />
                  );
                }}
              </VList>
            </div>
          </Show>
        </Match>
        {/* <Match when={props.viewType === 'grid'}>
          <div class="text-sm font-medium">Folders</div>
          <div class="grid grid-cols-1 @sm/block:grid-cols-2 @md/block:grid-cols-3 gap-4">
            <For
              each={sortedItemsToDisplay().filter(
                (item) => item.type === 'project'
              )}
            >
              {(item: Project) => {
                return (
                  <GridView
                    itemType={item.type}
                    id={item.id}
                    name={item.name}
                    owner={item.userId}
                    updatedAt={item.updatedAt}
                    createdAt={item.createdAt}
                    parentId={item.parentId ?? undefined}
                    pinned={isPinned(item.id)}
                    pinIndex={pinnedIds().indexOf(item.id)}
                    size={props.size}
                    // selectableTypes={props.selectableTypes}
                    // setSelectedItems={props.setSelectedItems}
                    // selectedItems={props.selectedItems}
                  />
                );
              }}
            </For>
          </div>
          <div class="text-sm font-medium">Files</div>
          <div class="grid grid-cols-1 gap-4">
            <For
              each={sortedItemsToDisplay().filter(
                (item) => item.type !== 'project'
              )}
            >
              {(item: Item) => {
                const commonProps = {
                  id: item.id,
                  name: item.name,
                  pinned: isPinned(item.id),
                  pinIndex: pinnedIds().indexOf(item.id),
                  updatedAt: item.updatedAt,
                  createdAt: item.createdAt,
                  parentId:
                    item.type === 'project'
                      ? (item.parentId ?? undefined)
                      : (item.projectId ?? undefined),
                };
                return (
                  <GridView
                    {...commonProps}
                    itemType={item.type}
                    owner={item.type === 'document' ? item.owner : item.userId}
                    fileType={
                      item.type === 'document'
                        ? (item.fileType as FileType)
                        : undefined
                    }
                    size={props.size}
                    // selectableTypes={props.selectableTypes}
                    // setSelectedItems={props.setSelectedItems}
                    // selectedItems={props.selectedItems}
                  />
                );
              }}
            </For>
          </div>
        </Match> */}
      </Switch>
    </div>
  );
}
