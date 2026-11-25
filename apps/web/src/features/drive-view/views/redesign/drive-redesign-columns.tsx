import { createFolderDropTargets } from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { isEditableInput } from '@core/util/isEditableInput';
import {
  createEntityDraggable,
  type EntityData,
  EntityRowIcon,
  formatRelativeTimestamp,
  OwnerLabel,
} from '@entity';
import ShareIcon from '@icon/share.svg';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Button, cn, Tooltip } from '@ui';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { InlineNameInput } from '../../components/redesign/inline-name-input';
import { driveKindLabel } from '../../components/redesign/kind-label';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import { buildMillerColumnPath } from '../../core/drive-columns';
import {
  driveItemKind,
  filterRootBrowseItems,
  orderDriveDisplayItems,
  splitOwnedAndSharedFolders,
  topLevelFolders,
} from '../../core/drive-items';
import { folderToProjectEntity } from './use-drive-display-items';

function MillerColumnPane(props: {
  folderId: string | null;
  columnIndex: number;
  selectedChildFolderId: string | undefined;
  selectedFileId: string | undefined;
  splitId: string;
  createDropTarget?: ReturnType<typeof createFolderDropTargets>;
  onSelectFolder: (folderId: string) => void;
  onSelectFile: (entity: EntityData) => void;
  onOpenFile: (entity: EntityData, event?: MouseEvent) => void;
}) {
  const { state, sidebar, actions } = useDriveView();
  const { preferences, inlineEdit, host, createFolderContents } =
    useDriveRedesign();
  const folderSource = createFolderContents(() => props.folderId);
  const columnDropTarget = props.createDropTarget?.(() => props.folderId);

  const columnTitle = () => {
    if (props.folderId === null) return t('drive.columnRootTitle');
    return (
      sidebar.folders().find((folder) => folder.id === props.folderId)?.name ??
      t('drive.folders')
    );
  };

  const items = createMemo<EntityData[]>(() => {
    const raw = folderSource.items().map((row) => row.entity);
    if (props.folderId === null) {
      const { owned } = splitOwnedAndSharedFolders(
        sidebar.folders(),
        actions.userId()
      );
      const topFolders = topLevelFolders(owned).map(folderToProjectEntity);
      const seen = new Set(topFolders.map((folder) => folder.id));
      const combined = [
        ...topFolders,
        ...raw.filter((entity) => !seen.has(entity.id)),
      ];
      const browse = filterRootBrowseItems(combined, 'browse', false);
      return orderDriveDisplayItems(browse, {
        foldersFirst: true,
        sort: state.value().sort,
        direction: preferences.sortDirection(),
      });
    }

    return orderDriveDisplayItems(raw, {
      foldersFirst: true,
      sort: state.value().sort,
      direction: preferences.sortDirection(),
    });
  });

  const isCreatingHere = () => {
    const target = inlineEdit.creatingFolder();
    return target?.surface === 'columns' && target.parentId === props.folderId;
  };

  const canCreateInColumn = () => {
    if (props.folderId === null) return true;
    const folder = sidebar
      .folders()
      .find((entry) => entry.id === props.folderId);
    return !folder || folder.userId === actions.userId();
  };

  return (
    <section
      ref={(el) => columnDropTarget?.ref(el)}
      aria-label={columnTitle()}
      class={cn(
        'flex h-full w-64 shrink-0 flex-col border-r border-edge-muted bg-surface transition-colors',
        columnDropTarget?.isOver() && 'bg-accent/8'
      )}
    >
      {/* Column header */}
      <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-edge-muted bg-panel/70 px-3">
        <Tooltip label={columnTitle()} class="min-w-0 max-w-full">
          <span class="min-w-0 truncate text-xs font-semibold text-ink">
            {columnTitle()}
          </span>
        </Tooltip>
        <div class="flex shrink-0 items-center gap-1">
          <span class="text-[11px] tabular-nums text-ink-subtle">
            {items().length}
          </span>
          <Show when={canCreateInColumn()}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('drive.newSubfolderIn', { name: columnTitle() })}
              tooltip={t('drive.newSubfolderIn', { name: columnTitle() })}
              onClick={() =>
                inlineEdit.startCreateFolder({
                  parentId: props.folderId,
                  surface: 'columns',
                })
              }
            >
              <PlusIcon class="size-3.5" aria-hidden="true" />
            </Button>
          </Show>
        </div>
      </div>

      {/* Column list */}
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5">
        <Show when={isCreatingHere()}>
          <div class="mb-1 flex h-9 items-center gap-2 rounded-lg border border-accent bg-accent/5 px-2">
            <FolderPlusIcon
              class="size-4 shrink-0 text-accent"
              aria-hidden="true"
            />
            <InlineNameInput
              initialValue=""
              isFolder
              placeholder={t('drive.folderNamePlaceholder')}
              ariaLabel={t('drive.newFolderInputLabel')}
              disabled={inlineEdit.isPending()}
              onCommit={(name) =>
                inlineEdit.runCommit(async () => {
                  const id = await host.createFolderInline(
                    name,
                    props.folderId
                  );
                  if (id) props.onSelectFolder(id);
                })
              }
              onCancel={inlineEdit.cancelCreateFolder}
            />
          </div>
        </Show>

        <Show
          when={!folderSource.isLoading() || items().length > 0}
          fallback={
            <div class="flex items-center justify-center py-8 text-xs text-ink-muted">
              <SpinnerIcon class="size-4 animate-spin" aria-hidden="true" />
            </div>
          }
        >
          <Show
            when={items().length > 0 || isCreatingHere()}
            fallback={
              <div class="px-3 py-8 text-center text-xs text-ink-subtle">
                {t('drive.columnEmpty')}
              </div>
            }
          >
            <ul class="flex flex-col gap-0.5">
              <For each={items()}>
                {(entity) => {
                  const isFolder = entity.type === 'project';
                  const isActiveFolder = () =>
                    isFolder && props.selectedChildFolderId === entity.id;
                  const isActiveFile = () =>
                    !isFolder && props.selectedFileId === entity.id;
                  const rowDropTarget = isFolder
                    ? props.createDropTarget?.(() => entity.id)
                    : undefined;
                  const attachDrag = createEntityDraggable({
                    entity,
                    splitId: props.splitId,
                  });
                  const isRenamingHere = () => {
                    const target = inlineEdit.renaming();
                    return (
                      target?.surface === 'columns' && target.id === entity.id
                    );
                  };

                  return (
                    <li>
                      <div
                        ref={(el) => {
                          rowDropTarget?.ref(el);
                          attachDrag(el);
                        }}
                        role="button"
                        tabIndex={0}
                        data-drive-column-item={entity.id}
                        aria-current={
                          isActiveFolder() || isActiveFile()
                            ? 'true'
                            : undefined
                        }
                        class={cn(
                          'group/col-row flex h-9 min-w-0 items-center gap-2 rounded-lg px-2 text-sm transition-colors select-none outline-none focus-visible:outline-2 focus-visible:outline-accent',
                          isActiveFolder() || isActiveFile()
                            ? 'bg-accent/14 font-medium text-ink'
                            : 'text-ink hover:bg-hover',
                          rowDropTarget?.isOver() &&
                            'bg-accent/18 outline-2 -outline-offset-2 outline-accent'
                        )}
                        onClick={() => {
                          if (isFolder) props.onSelectFolder(entity.id);
                          else props.onSelectFile(entity);
                        }}
                        onDblClick={(event) => {
                          if (!isFolder) props.onOpenFile(entity, event);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            if (isFolder) props.onSelectFolder(entity.id);
                            else props.onOpenFile(entity);
                          }
                        }}
                      >
                        <span class="flex size-4 shrink-0 items-center justify-center">
                          <EntityRowIcon entity={entity} />
                        </span>
                        <Show
                          when={isRenamingHere()}
                          fallback={
                            <Tooltip label={entity.name} class="min-w-0 flex-1">
                              <span class="min-w-0 flex-1 truncate">
                                {entity.name}
                              </span>
                            </Tooltip>
                          }
                        >
                          <InlineNameInput
                            initialValue={entity.name}
                            isFolder={isFolder}
                            ariaLabel={t('drive.renameInputLabel', {
                              name: entity.name,
                            })}
                            disabled={inlineEdit.isPending()}
                            onCommit={(nextName) =>
                              inlineEdit.runCommit(async () => {
                                await host.renameEntityInline(entity, nextName);
                              })
                            }
                            onCancel={inlineEdit.cancelRename}
                          />
                        </Show>
                        <Show when={isFolder}>
                          <CaretRightIcon
                            class="size-3 shrink-0 text-ink-subtle"
                            aria-hidden="true"
                          />
                        </Show>
                      </div>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </Show>
      </div>
    </section>
  );
}

/**
 * macOS Finder-inspired Miller Columns view: each folder opens into a sibling
 * pane to the right, every column and folder row is a live drag-drop target,
 * and selecting a file displays an instant inline preview card on the right.
 */
export function DriveRedesignColumns() {
  const { state, sidebar, actions } = useDriveView();
  const { inlineEdit, inspector, host, setInspectedEntity } =
    useDriveRedesign();
  const panel = useSplitPanelOrThrow();
  const createDropTarget = createFolderDropTargets();

  const [selectedFile, setSelectedFile] = createSignal<
    EntityData | undefined
  >();
  let scrollerRef: HTMLDivElement | undefined;

  const columnFolderIds = createMemo(() =>
    buildMillerColumnPath(sidebar.folders(), state.projectId() ?? null)
  );

  // Smoothly scroll newly revealed columns into view on navigation.
  createEffect(() => {
    columnFolderIds();
    selectedFile();
    requestAnimationFrame(() => {
      if (scrollerRef) {
        scrollerRef.scrollTo({
          left: scrollerRef.scrollWidth,
          behavior: 'smooth',
        });
      }
    });
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (inlineEdit.isEditing() || isEditableInput(event.target as Element)) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      fireAndForget(host.undoLatestWithToast(), 'drive-columns-undo');
      return;
    }
    if (event.key === 'ArrowLeft') {
      const path = columnFolderIds();
      if (path.length <= 1) return;
      event.preventDefault();
      setSelectedFile(undefined);
      const parentId = path[path.length - 2];
      if (parentId) state.selectFolder(parentId);
      else state.selectTab('owned');
      return;
    }
    if (event.key === ' ') {
      const file = selectedFile();
      if (!file) return;
      event.preventDefault();
      setInspectedEntity(file);
      inspector.toggle();
    }
  };

  return (
    <div
      ref={scrollerRef}
      tabIndex={0}
      aria-label={t('drive.viewColumns')}
      class="flex size-full min-h-0 min-w-0 flex-row overflow-x-auto overflow-y-hidden bg-inset/30 outline-none"
      onKeyDown={handleKeyDown}
    >
      <For each={columnFolderIds()}>
        {(folderId, index) => (
          <MillerColumnPane
            folderId={folderId}
            columnIndex={index()}
            selectedChildFolderId={columnFolderIds()[index() + 1] ?? undefined}
            selectedFileId={selectedFile()?.id}
            splitId={panel.handle.id}
            createDropTarget={createDropTarget}
            onSelectFolder={(id) => {
              setSelectedFile(undefined);
              const folder = sidebar.folders().find((f) => f.id === id);
              if (folder) setInspectedEntity(folderToProjectEntity(folder));
              state.selectFolder(id);
            }}
            onSelectFile={(entity) => {
              setSelectedFile(entity);
              setInspectedEntity(entity);
            }}
            onOpenFile={(entity, event) => actions.openEntity(entity, event)}
          />
        )}
      </For>

      {/* Finder-style inline file preview column when a file is selected */}
      <Show when={selectedFile()}>
        {(file) => {
          const kind = () => driveItemKind(file());
          const canMutate = () => host.canMutateEntity(file());
          const ownerId = () =>
            'ownerId' in file() ? file().ownerId : undefined;
          const updatedAt = () =>
            file().type === 'database' || file().type === 'form'
              ? file().createdAt
              : file().updatedAt;

          return (
            <aside
              aria-label={t('drive.columnPreviewHeading')}
              class="flex h-full w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-edge-muted bg-panel p-5"
            >
              <div class="flex h-36 items-center justify-center rounded-xl border border-edge-muted bg-surface shadow-xs">
                <span class="size-12">
                  <EntityRowIcon entity={file()} />
                </span>
              </div>

              <div class="flex flex-col gap-1">
                <h3 class="text-sm font-semibold wrap-anywhere text-ink">
                  {file().name}
                </h3>
                <p class="text-xs text-ink-muted">
                  {driveKindLabel(kind())}
                  <Show when={updatedAt()}>
                    {(date) => ` · ${formatRelativeTimestamp(date())}`}
                  </Show>
                </p>
              </div>

              <div class="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(event) => actions.openEntity(file(), event)}
                >
                  <ArrowUpRightIcon class="size-3.5" aria-hidden="true" />
                  <span>{t('drive.openFullView')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setInspectedEntity(file());
                    inspector.open('preview');
                  }}
                >
                  <EyeIcon class="size-3.5" aria-hidden="true" />
                  <span>{t('drive.quickLook')}</span>
                </Button>
              </div>

              <dl class="flex flex-col gap-2.5 border-t border-edge-muted pt-3 text-xs">
                <div class="flex items-center justify-between gap-2">
                  <dt class="text-ink-muted">{t('drive.inspectorOwner')}</dt>
                  <dd class="min-w-0 text-ink">
                    <OwnerLabel
                      ownerId={ownerId()}
                      viewerLabel={t('drive.ownerYou')}
                      iconClass="size-4"
                      suppressClick
                    />
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <dt class="text-ink-muted">{t('drive.inspectorKind')}</dt>
                  <dd class="text-ink">{driveKindLabel(kind())}</dd>
                </div>
              </dl>

              <div class="mt-auto flex flex-wrap gap-1.5 border-t border-edge-muted pt-3">
                <Show when={canMutate()}>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      inlineEdit.startRename({
                        id: file().id,
                        name: file().name,
                        isFolder: false,
                        surface: 'columns',
                      })
                    }
                  >
                    <PencilIcon class="size-3.5" aria-hidden="true" />
                    <span>{t('drive.rename')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => host.openMoveDialog([file()])}
                  >
                    <FolderIcon class="size-3.5" aria-hidden="true" />
                    <span>{t('drive.move')}</span>
                  </Button>
                </Show>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => host.shareEntities([file()])}
                >
                  <ShareIcon class="size-3.5" aria-hidden="true" />
                  <span>{t('drive.share')}</span>
                </Button>
                <Show when={canMutate()}>
                  <Button
                    variant="ghost"
                    size="xs"
                    class="text-failure-ink hover:text-failure-ink"
                    onClick={() => {
                      const target = file();
                      setSelectedFile(undefined);
                      fireAndForget(
                        host.trashEntitiesWithUndo([target]),
                        'drive-columns-trash'
                      );
                    }}
                  >
                    <TrashIcon class="size-3.5" aria-hidden="true" />
                    <span>{t('drive.moveToTrash')}</span>
                  </Button>
                </Show>
              </div>
            </aside>
          );
        }}
      </Show>
    </div>
  );
}
