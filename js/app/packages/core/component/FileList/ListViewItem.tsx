import { EditableLabel, EditingContext } from '@core/component/Editable';
import {
  CustomEntityIcon,
  EntityIcon,
  ICON_SIZE_CLASSES,
} from '@core/component/EntityIcon';
import {
  FILE_LIST_ROW_HEIGHT,
  type FileListSize,
  TEXT_SIZE_CLASSES,
} from '@core/component/FileList/constants';
import {
  Caret,
  CaretSpacer,
  ExplorerSpacer,
} from '@core/component/FileList/ExplorerSpacer';
import type { FileTree } from '@core/component/FileList/fileTree';
import { HoverButtonWrapper } from '@core/component/FileList/HoverButtonWrapper';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import type { ViewType } from '@core/component/FileList/viewTypes';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { idToEmail } from '@core/user';
import { type SortPair, sortItems } from '@core/util/sort';
import { formatRelativeDate } from '@core/util/time';
import { propsToHref } from '@core/util/url';
import ClockArrow from '@icon/regular/clock-counter-clockwise.svg?component-solid';
import ThreeDotsIcon from '@icon/regular/dots-three.svg?component-solid';
import Pin from '@icon/regular/push-pin.svg?component-solid';
import Trash from '@icon/regular/trash.svg?component-solid';
import { ContextMenu } from '@kobalte/core/context-menu';
import { useUserId } from '@service-gql/client';
import type { ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import type { Item } from '@service-storage/generated/schemas/item';
import type { Project } from '@service-storage/generated/schemas/project';
import { usePinnedIds } from '@service-storage/pins';
import { useCreateProject } from '@service-storage/projects';
import { reverseFormatDocumentName } from '@service-storage/util/filename';
import { refetchResources } from '@service-storage/util/refetchResources';
import {
  type Accessor,
  type Component,
  createMemo,
  createSelector,
  createSignal,
  For,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import type { SetStoreFunction, Store } from 'solid-js/store';
import { DeleteConfimationDialog } from '../DeleteConfimationDialog';
import { FileSelectDialog } from '../FileSelectDialog';
import { IconButton } from '../IconButton';
import { DragAndDropWrapper } from './DragAndDropWrapper';
import { ItemContextMenu, TrashItemContextMenu } from './ItemContextMenu';
import {
  ActionColumn,
  NameColumn,
  OwnerColumn,
  TimeColumn,
} from './ListViewColumns';
import { NavWrapper } from './NavWrapper';
import { NewProjectItem } from './NewProjectItem';
import { SelectionWrapper } from './SelectionWrapper';

// A function toggling project ids as keys to expandedProjects store
export const toggleExpandedProject = (
  projectId: string,
  [expandedProjects, setExpandedProjects]: [
    Store<{ [key: string]: boolean }>,
    SetStoreFunction<{ [key: string]: boolean }>,
  ]
) => {
  if (expandedProjects[`${projectId}`]) {
    setExpandedProjects(
      (otherProjects: Record<string, boolean | undefined>) => ({
        ...otherProjects,
        [`${projectId}`]: undefined,
      })
    );
  } else {
    setExpandedProjects(
      (otherProjects: Record<string, boolean | undefined>) => ({
        ...otherProjects,
        [`${projectId}`]: true,
      })
    );
  }
};

// A function to set the expanded state of an individual project
export const setExpandedProject = (
  projectId: string,
  isExpanded: boolean,
  expandedProjectsStore: [
    Store<{ [key: string]: boolean }>,
    SetStoreFunction<{ [key: string]: boolean }>,
  ]
) => {
  const setExpandedProjects = expandedProjectsStore[1];
  setExpandedProjects((otherProjects: Record<string, boolean | undefined>) => ({
    ...otherProjects,
    [`${projectId}`]: isExpanded,
  }));
};

type EditableItemProps = {
  onSubmitEdit: (edit: string) => void;
  name: string;
  size: FileListSize;
};

export function EditingItem(props: EditableItemProps) {
  const [_, setIsEditing] = useContext(EditingContext);
  return (
    <EditableLabel
      handleSubmitEdit={props.onSubmitEdit}
      handleCancelEdit={() => setIsEditing(false)}
      labelText={props.name}
      size={props.size}
    />
  );
}

export type ListViewItemProps = {
  itemType: ItemType;
  fileType?: FileType;
  childItems?: Item[];
  id: string;
  name: string;
  owner: string;
  updatedAt: number;
  createdAt: number;
  parentId?: string;
  pinned?: boolean;
  pinIndex?: number;
  size: FileListSize;
  viewType: ViewType;
  depth?: number;
  currentFileTree: FileTree;
  selectableTypes?: ItemType[];
  selectedItems: Accessor<Item[]>;
  setSelectedItems: Setter<Item[]>;
  customIconComponent?: Component;
  expandedProjectsStore: [
    Store<{ [key: string]: boolean }>,
    SetStoreFunction<{ [key: string]: boolean }>,
  ];
  fileSort: Accessor<SortPair>;
  showProjectsFirst: boolean;
  hideOwner?: boolean;
  hideDate?: boolean;
  hideAction?: boolean;
  insideProjectBlock?: boolean;
  setBlockProject?: (project: Project) => void;
  openItemsInSplit?: boolean;
  fileExplorerParentId?: string;
  selectionOnly?: boolean;
};

export function ListViewItem(props: ListViewItemProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [isCreatingProject, setIsCreatingProject] = createSignal(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] =
    createSignal(false);
  const [showMoveToFolder, setShowMoveToFolder] = createSignal(false);
  // const [moveToFolderOpen, setMoveToFolderOpen] = createSignal(false);
  const pinnedIds = usePinnedIds();
  const [expandedProjects, setExpandedProjects] = props.expandedProjectsStore;
  const isExpanded = createMemo(() => {
    return expandedProjects[`${props.id}`];
  });
  const isPinned = createSelector(pinnedIds, (id: string, pinnedIds) =>
    pinnedIds.includes(id)
  );
  const userId = useUserId();

  // const isOwner = createSelector(userId);

  const {
    renameItem,
    revertDelete,
    permanentlyDelete,
    bulkPermanentlyDelete,
    bulkDelete,
    deleteItem,
    bulkMoveToFolder,
    moveToFolder,
  } = useItemOperations();

  const blockName = createMemo(() => {
    return fileTypeToBlockName(props.fileType ?? props.itemType);
  });
  const href = () => propsToHref({ fileType: blockName(), id: props.id });

  const deactivated = createMemo(() => {
    if (props.selectionOnly) {
      return !props.selectableTypes?.includes(props.itemType);
    }
    return false;
  });

  const sortedChildren = createMemo(() => {
    if (!props.childItems || props.viewType === 'flatList') return [];
    const currentPinnedIds = pinnedIds();
    const [sortType, sortDirection] = props.fileSort();

    return [...props.childItems].sort((a, b) => {
      const aIsPinned = currentPinnedIds.includes(a.id);
      const bIsPinned = currentPinnedIds.includes(b.id);

      if (aIsPinned && bIsPinned) {
        const aIndex = currentPinnedIds.indexOf(a.id);
        const bIndex = currentPinnedIds.indexOf(b.id);
        return aIndex - bIndex;
      }

      if (aIsPinned) return -1;
      if (bIsPinned) return 1;

      return sortItems(a, b, sortType, sortDirection, {
        showProjectsFirst: props.showProjectsFirst
          ? props.showProjectsFirst
          : undefined,
      });
    });
  });

  const getActiveClass = createMemo(() => `bg-active ring-1 ring-edge`);

  const inactiveClass = createMemo(
    () =>
      `group hover:bg-hover hover:transition-none transition-all hover:ring-1 hover:ring-edge ${contextMenuOpen() ? 'bg-hover' : ''}`
  );

  const baseName = createMemo(() =>
    reverseFormatDocumentName(props.name, props.fileType)
  );

  const formattedOwner =
    props.owner === userId() ? 'Me' : idToEmail(props.owner).split('@')[0];

  const onCaretClick = (e: MouseEvent) => {
    if (props.itemType !== 'project') return;
    e.preventDefault();
    e.stopPropagation();
    toggleExpandedProject(props.id, [expandedProjects, setExpandedProjects]);
  };

  const spacersAndCarets = createMemo(() => {
    if (props.viewType === 'treeList') {
      if (props.itemType !== 'project' || props.id === 'trash') {
        return (
          <>
            <ExplorerSpacer depth={props.depth} size={props.size} />
            <Show when={props.depth !== undefined}>
              <CaretSpacer size={props.size} />
            </Show>
          </>
        );
      } else {
        return (
          <>
            <ExplorerSpacer depth={props.depth} size={props.size} />
            <Caret isExpanded={isExpanded()} size={props.size} />
          </>
        );
      }
    }
    return <CaretSpacer size={props.size} />;
  });

  const createProject = useCreateProject();
  async function createNewProject(name: string, parentId: string) {
    createProject({
      name,
      parentId,
    });
    setIsCreatingProject(false);
    refetchResources();
  }

  const isMultiSelected = createMemo(
    () =>
      props.selectedItems().some((item) => item.id === props.id) &&
      props.selectedItems().length > 1
  );

  const deleteConfirmationText = () => {
    if (props.fileExplorerParentId === 'trash') {
      const truncatedItemName =
        props.name?.length > 20 ? props.name.slice(0, 20) + '...' : props.name;
      return isMultiSelected()
        ? `Are you sure you want to <b>permanently delete ${props.selectedItems().length} items?</b> This action cannot be undone.`
        : `Are you sure you want to <b>permanently delete</b> <b>${truncatedItemName} ${props.itemType === 'project' ? 'and all of its contents' : ''}</b>? This action cannot be undone.`;
    } else {
      const truncatedItemName =
        props.name?.length > 20 ? props.name.slice(0, 20) + '...' : props.name;
      return isMultiSelected()
        ? `Are you sure you want to delete <b>${props.selectedItems().length} items?</b>`
        : `Are you sure you want to delete <b>${truncatedItemName} and all of its contents</b>?`;
    }
  };

  const deleteHandler = () => {
    if (isMultiSelected()) {
      bulkDelete(props.selectedItems()).then((result) => {
        if (result.success) {
          props.setSelectedItems([]);
        } else {
          props.setSelectedItems(result.failedItems);
        }
      });
    } else {
      deleteItem({
        itemType: props.itemType,
        id: props.id,
        itemName: props.name,
      });
    }
  };

  const moveToFolderHandler = (folder: Project) => {
    if (!isMultiSelected()) {
      moveToFolder({
        itemType: props.itemType,
        id: props.id,
        itemName: props.name,
        folderId: folder.id,
        folderName: folder.name,
      });
    } else {
      bulkMoveToFolder(props.selectedItems(), folder.id, folder.name);
    }
    setShowMoveToFolder(false);
  };

  const permanentlyDeleteHandler = () => {
    if (isMultiSelected()) {
      bulkPermanentlyDelete(props.selectedItems()).then((result) => {
        if (result.success) {
          props.setSelectedItems([]);
        } else {
          props.setSelectedItems(result.failedItems);
        }
      });
    } else {
      permanentlyDelete({
        itemType: props.itemType,
        id: props.id,
        itemName: props.name,
      });
    }
  };

  return (
    <>
      <Show when={props.itemType === 'project'}>
        <style>
          {`
          .explorer-level-${props.depth ?? 0}:has(.explorer-child-${(props.depth ?? 0) + 1}) {
            --tw-ring-inset: inset;
            --tw-ring-offset-width: 2px;
            --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor);
            box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
            --tw-ring-color: var(--color-blue-200);
          }
          `}
        </style>
      </Show>
      <div
        class={`${props.itemType === 'project' ? `explorer-level-${props.depth ?? 0} rounded-lg` : ''}`}
      >
        <EditingContext.Provider value={[isEditing, setIsEditing]}>
          <ContextMenu
            placement="bottom-start"
            flip={
              isMobileWidth() && isTouchDevice
                ? 'top-end'
                : props.insideProjectBlock
                  ? 'left-start'
                  : 'right-end'
            }
            onOpenChange={setContextMenuOpen}
          >
            <ContextMenu.Trigger
              disabled={props.selectionOnly || props.id === 'trash'}
            >
              <SelectionWrapper
                id={props.id}
                itemType={props.itemType}
                selectableTypes={props.selectableTypes}
                selectedItems={props.selectedItems}
                setSelectedItems={props.setSelectedItems}
                currentFileTree={props.currentFileTree}
                expandedProjects={expandedProjects}
                showProjectsFirst={props.showProjectsFirst}
                fileSort={props.fileSort}
                singleSelect={props.selectionOnly}
                deactivated={deactivated()}
              >
                <DragAndDropWrapper
                  itemType={props.itemType}
                  fileType={props.fileType}
                  id={props.id}
                  name={props.name}
                  isOwner={props.owner === userId()}
                  parentId={props.parentId ?? ''}
                  lastEdited={props.updatedAt.toString()}
                  depth={props.depth ?? 0}
                  context={props.insideProjectBlock ? 'projectBlock' : ''}
                  isEditing={isEditing()}
                  selectedItems={props.selectedItems}
                  setSelectedItems={props.setSelectedItems}
                  size={props.size}
                  deactivated={deactivated()}
                >
                  <NavWrapper
                    blockName={blockName()}
                    id={props.id}
                    itemType={props.itemType}
                    href={href()}
                    activeClass={getActiveClass()}
                    inactiveClass={inactiveClass()}
                    openInSplit={props.openItemsInSplit}
                    class={`flex items-center w-full justify-between ${FILE_LIST_ROW_HEIGHT[props.size]} group/item ${deactivated() ? 'opacity-50' : ''}`}
                    insideProjectBlock={props.insideProjectBlock}
                    setBlockProject={props.setBlockProject}
                    selectionOnly={props.selectionOnly}
                  >
                    <NameColumn>
                      <div
                        class="group/project flex items-center h-full text-accent"
                        onclick={
                          props.depth === undefined ? () => {} : onCaretClick
                        }
                      >
                        {spacersAndCarets()}
                        <Show
                          when={props.customIconComponent}
                          fallback={
                            <EntityIcon
                              size={'md'}
                              targetType={
                                props.itemType === 'document'
                                  ? props.fileType
                                  : props.itemType
                              }
                              shared={props.owner !== userId()}
                            />
                          }
                        >
                          {(Icon) => (
                            <CustomEntityIcon icon={Icon()} size={props.size} />
                          )}
                        </Show>
                      </div>
                      <Show
                        when={!isEditing()}
                        fallback={
                          <EditingItem
                            size={props.size}
                            name={baseName()}
                            onSubmitEdit={(documentName) =>
                              renameItem({
                                itemType: props.itemType,
                                id: props.id,
                                itemName: props.name,
                                newName: documentName,
                              })
                            }
                          />
                        }
                      >
                        <div class="flex-1 min-w-0 overflow-hidden">
                          <TruncatedText size={props.size}>
                            {props.name}
                          </TruncatedText>
                        </div>
                      </Show>
                    </NameColumn>
                    <Show when={!props.hideOwner}>
                      <OwnerColumn>
                        <UserIcon
                          id={props.owner}
                          size={props.size}
                          isDeleted={false}
                        />
                        <TruncatedText size={props.size}>
                          {formattedOwner}
                        </TruncatedText>
                      </OwnerColumn>
                    </Show>
                    <Show when={!props.hideDate}>
                      <TimeColumn>
                        <div class={`px-2 ${TEXT_SIZE_CLASSES[props.size]}`}>
                          {formatRelativeDate(
                            new Date(props.updatedAt * 1000).toISOString()
                          )}
                        </div>
                      </TimeColumn>
                    </Show>
                    <Show when={!props.hideAction}>
                      <ActionColumn class={`pr-4`}>
                        <Show
                          when={props.fileExplorerParentId !== 'trash'}
                          fallback={
                            <div
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              class="flex gap-2"
                            >
                              <IconButton
                                icon={ClockArrow}
                                onClick={() => {
                                  revertDelete({
                                    itemType: props.itemType,
                                    id: props.id,
                                    itemName: props.name,
                                  });
                                }}
                                theme="green"
                                tooltip={{ label: 'Move item out of trash' }}
                              />
                              <IconButton
                                icon={Trash}
                                onClick={() => {
                                  permanentlyDelete({
                                    itemType: props.itemType,
                                    id: props.id,
                                    itemName: props.name,
                                  });
                                }}
                                theme="red"
                                tooltip={{ label: 'Permanently delete' }}
                              />
                            </div>
                          }
                        >
                          <Show when={props.pinned}>
                            <div
                              class={`flex ${!props.selectionOnly ? 'group-hover/item:hidden' : ''}`}
                            >
                              <Pin class={`${ICON_SIZE_CLASSES[props.size]}`} />
                            </div>
                          </Show>
                          <Show when={!props.selectionOnly}>
                            <HoverButtonWrapper
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                // Create a new MouseEvent for right click
                                const rightClickEvent = new MouseEvent(
                                  'contextmenu',
                                  {
                                    bubbles: true,
                                    cancelable: true,
                                    view: window,
                                    button: 2, // Right mouse button
                                    buttons: 2,
                                    clientX:
                                      e.currentTarget.getBoundingClientRect()
                                        .left +
                                      e.currentTarget.offsetWidth / 2,
                                    clientY:
                                      e.currentTarget.getBoundingClientRect()
                                        .top +
                                      e.currentTarget.offsetHeight / 2,
                                  }
                                );
                                // Dispatch the event on the current target
                                e.currentTarget.dispatchEvent(rightClickEvent);
                              }}
                              size={props.size}
                              showOnHover
                            >
                              <ThreeDotsIcon class="size-full" />
                            </HoverButtonWrapper>
                          </Show>
                        </Show>
                      </ActionColumn>
                    </Show>
                  </NavWrapper>
                </DragAndDropWrapper>
              </SelectionWrapper>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <Show
                when={props.fileExplorerParentId !== 'trash'}
                fallback={
                  <TrashItemContextMenu
                    itemType={props.itemType}
                    id={props.id}
                    name={props.name}
                    selectedItems={props.selectedItems()}
                    setSelectedItems={props.setSelectedItems}
                    isMultiSelected={isMultiSelected()}
                    setShowDeleteConfirmation={setShowDeleteConfirmation}
                  />
                }
              >
                <ItemContextMenu
                  itemType={props.itemType}
                  id={props.id}
                  name={props.name}
                  blockName={blockName()}
                  href={href()}
                  renameHandler={() => {
                    setIsEditing(true);
                  }}
                  pinned={isPinned(props.id)}
                  setIsCreatingProject={setIsCreatingProject}
                  setIsExpanded={(isExpanded: boolean) => {
                    setExpandedProject(props.id, isExpanded, [
                      expandedProjects,
                      setExpandedProjects,
                    ]);
                  }}
                  selectedItems={props.selectedItems()}
                  setSelectedItems={props.setSelectedItems}
                  insideProjectBlock={props.insideProjectBlock ?? false}
                  setShowDeleteConfirmation={setShowDeleteConfirmation}
                  isMultiSelected={isMultiSelected()}
                  setShowMoveToFolder={setShowMoveToFolder}
                />
              </Show>
            </ContextMenu.Portal>
          </ContextMenu>

          <DeleteConfimationDialog
            open={showDeleteConfirmation()}
            setOpen={setShowDeleteConfirmation}
            onDelete={
              props.fileExplorerParentId === 'trash'
                ? permanentlyDeleteHandler
                : deleteHandler
            }
            deleteConfirmationText={deleteConfirmationText}
          />
          <FileSelectDialog
            itemId={props.id}
            open={showMoveToFolder()}
            setOpen={setShowMoveToFolder}
            selectableTypes={['project']}
            onSelect={moveToFolderHandler}
            title={
              isMultiSelected()
                ? `Move ${props.selectedItems().length} items`
                : `Move "${props.name}"`
            }
          />
        </EditingContext.Provider>
        <Show
          when={
            props.itemType === 'project' &&
            isExpanded() &&
            props.viewType === 'treeList'
          }
        >
          <Show when={isCreatingProject()}>
            <NewProjectItem
              size={props.size}
              onSubmitEdit={(name) => createNewProject(name, props.id)}
              onCancelEdit={() => setIsCreatingProject(false)}
              depth={props.depth === undefined ? undefined : props.depth + 1}
              hideOwner={props.hideOwner}
              hideDate={props.hideDate}
              hideAction={props.hideAction}
            />
          </Show>
          <For each={sortedChildren()}>
            {(item: Item) => {
              const childItems =
                item.type === 'project'
                  ? props.currentFileTree.itemMap[item.id]?.children
                  : undefined;

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
                  childItems={item.type === 'project' ? childItems : undefined}
                  owner={item.type === 'document' ? item.owner : item.userId}
                  size={props.size}
                  viewType={'treeList'}
                  depth={
                    props.depth === undefined ? undefined : props.depth + 1
                  }
                  selectableTypes={props.selectableTypes}
                  setSelectedItems={props.setSelectedItems}
                  selectedItems={props.selectedItems}
                  expandedProjectsStore={props.expandedProjectsStore}
                  currentFileTree={props.currentFileTree}
                  fileSort={props.fileSort}
                  showProjectsFirst={props.showProjectsFirst}
                  fileExplorerParentId={props.fileExplorerParentId}
                  hideOwner={props.hideOwner}
                  hideDate={props.hideDate}
                  hideAction={props.hideAction}
                  selectionOnly={props.selectionOnly}
                />
              );
            }}
          </For>
        </Show>
      </div>
    </>
  );
}
