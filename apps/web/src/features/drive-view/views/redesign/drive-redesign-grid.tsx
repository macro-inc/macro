import { createFolderDropTargets } from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import { fireAndForget } from '@core/util/fireAndForget';
import { isEditableInput } from '@core/util/isEditableInput';
import {
  createEntityDraggable,
  type EntityData,
  EntityDragSelectionContext,
  EntityRowIcon,
  formatRelativeTimestamp,
  MultiSelectCheckbox,
  OwnerLabel,
} from '@entity';
import ShareIcon from '@icon/share.svg';
import StarFillIcon from '@icon/system/fill/star-fill.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Key } from '@solid-primitives/keyed';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, cn, Dropdown, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import {
  DriveContentSkeleton,
  DriveRedesignEmptyState,
} from '../../components/redesign/drive-empty-state';
import { DriveSelectionToolbar } from '../../components/redesign/drive-selection-toolbar';
import { InlineNameInput } from '../../components/redesign/inline-name-input';
import {
  driveKindExtensionBadge,
  driveKindLabel,
} from '../../components/redesign/kind-label';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import {
  driveItemKind,
  partitionFoldersAndFiles,
} from '../../core/drive-items';
import { gridNextIndex } from '../../core/drive-view-mode';
import { folderAncestors } from '../../core/folder-tree';
import {
  type DriveDisplayRow,
  useDriveDisplayItems,
} from '../shared/use-drive-display-items';

function GridCardMenu(props: {
  row: DriveDisplayRow;
  onActivate: () => void;
  onQuickLook: () => void;
  onStartRename: () => void;
}) {
  const { host } = useDriveRedesign();
  const canMutate = () => host.canMutateEntity(props.row.entity);

  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        as={Button}
        variant="ghost"
        size="icon-xs"
        aria-label={t('drive.moreActions')}
        class="bg-panel/80 backdrop-blur-xs"
      >
        <DotsIcon class="size-3.5" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-44">
        <Dropdown.Item onSelect={props.onActivate}>
          <span>
            {props.row.isFolder
              ? t('drive.openFolder')
              : t('drive.openFullView')}
          </span>
        </Dropdown.Item>
        <Dropdown.Item onSelect={props.onQuickLook}>
          <EyeIcon class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('drive.quickLook')}</span>
        </Dropdown.Item>
        <Show when={canMutate()}>
          <Dropdown.Item onSelect={props.onStartRename}>
            <PencilIcon class="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t('drive.rename')}</span>
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => host.openMoveDialog([props.row.entity])}
          >
            <FolderIcon class="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t('drive.move')}</span>
          </Dropdown.Item>
        </Show>
        <Dropdown.Item onSelect={() => host.shareEntities([props.row.entity])}>
          <ShareIcon class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('drive.share')}</span>
        </Dropdown.Item>
        <Dropdown.Item
          onSelect={() =>
            fireAndForget(
              host.duplicateEntities([props.row.entity]),
              'drive-grid-dup'
            )
          }
        >
          <span>{t('drive.duplicate')}</span>
        </Dropdown.Item>
        <Show when={canMutate()}>
          <Dropdown.Separator />
          <Dropdown.Item
            class="text-failure-ink"
            onSelect={() =>
              fireAndForget(
                host.trashEntitiesWithUndo([props.row.entity]),
                'drive-grid-trash'
              )
            }
          >
            <TrashIcon class="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t('drive.moveToTrash')}</span>
          </Dropdown.Item>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}

function FolderGridCard(props: {
  row: DriveDisplayRow;
  focused: boolean;
  selected: boolean;
  selectedEntities: () => EntityData[];
  onClearSelection: () => void;
  splitId: string;
  createDropTarget?: ReturnType<typeof createFolderDropTargets>;
  onFocus: () => void;
  onToggleSelect: (shiftKey: boolean) => void;
  onActivate: (event?: MouseEvent) => void;
}) {
  const { actions } = useDriveView();
  const { inlineEdit, inspector, host } = useDriveRedesign();
  const isShared = () => {
    const ownerId =
      'ownerId' in props.row.entity ? props.row.entity.ownerId : undefined;
    const viewerId = actions.userId();
    return Boolean(ownerId && viewerId && ownerId !== viewerId);
  };
  const starred = () => host.isStarred(props.row.entity);
  const dropTarget = props.createDropTarget?.(() => props.row.id);

  const attachDrag = createEntityDraggable({
    get entity() {
      return props.row.entity;
    },
    splitId: props.splitId,
    instanceKey: 'grid-folder',
    selection: {
      entities: () =>
        props.selected ? props.selectedEntities() : [props.row.entity],
      selected: props.selectedEntities,
      clear: props.onClearSelection,
    },
  });

  const isRenamingHere = () => {
    const target = inlineEdit.renaming();
    return target?.surface === 'grid' && target.id === props.row.id;
  };

  const startRename = () => {
    if (!host.canMutateEntity(props.row.entity)) return;
    inlineEdit.startRename({
      id: props.row.id,
      name: props.row.entity.name,
      isFolder: true,
      surface: 'grid',
    });
  };

  return (
    <div
      ref={(el) => {
        dropTarget?.ref(el);
        attachDrag(el);
      }}
      role="gridcell"
      aria-selected={props.selected}
      data-drive-card-id={props.row.id}
      class={cn(
        'group/card relative flex h-14 min-w-0 items-center gap-3 rounded-xl border px-3 transition-colors select-none',
        props.selected
          ? 'border-accent bg-accent/10'
          : props.focused
            ? 'border-edge-focus bg-hover/70'
            : 'border-edge-muted bg-panel hover:border-edge hover:bg-hover/50',
        dropTarget?.isOver() && 'border-accent bg-accent/14 ring-2 ring-accent'
      )}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          props.onFocus();
          props.onToggleSelect(event.shiftKey);
          return;
        }
        props.onFocus();
        props.onActivate(event);
      }}
    >
      <div
        class={cn(
          'flex size-5 shrink-0 items-center justify-center transition-opacity',
          props.selected
            ? 'opacity-100'
            : 'opacity-0 group-hover/card:opacity-100 focus-within:opacity-100'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <MultiSelectCheckbox
          checked={props.selected}
          onChecked={(_checked, shiftKey) =>
            props.onToggleSelect(Boolean(shiftKey))
          }
        />
      </div>

      <span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-inset text-ink">
        <EntityRowIcon entity={props.row.entity} class="size-4.5" />
      </span>

      <div class="flex min-w-0 flex-1 flex-col">
        <Show
          when={isRenamingHere()}
          fallback={
            <Tooltip label={props.row.entity.name} class="min-w-0 max-w-full">
              <span class="truncate text-sm font-medium text-ink">
                {props.row.entity.name || t('drive.folderNamePlaceholder')}
              </span>
            </Tooltip>
          }
        >
          <InlineNameInput
            initialValue={props.row.entity.name}
            isFolder
            ariaLabel={t('drive.renameInputLabel', {
              name: props.row.entity.name,
            })}
            disabled={inlineEdit.isPending()}
            onCommit={(nextName) =>
              inlineEdit.runCommit(async () => {
                await host.renameEntityInline(props.row.entity, nextName);
              })
            }
            onCancel={inlineEdit.cancelRename}
          />
        </Show>
        <div class="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <Show
            when={props.row.subfolderCount > 0}
            fallback={<span>{t('drive.kindFolder')}</span>}
          >
            <span>
              {t('drive.subfolderCount', { count: props.row.subfolderCount })}
            </span>
          </Show>
          <Show when={isShared()}>
            <span>· {t('drive.sharedLabel')}</span>
          </Show>
        </div>
      </div>

      <div
        class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        <Show when={starred()}>
          <StarFillIcon
            class="size-3 text-warning"
            aria-label={t('drive.starred')}
          />
        </Show>
        <GridCardMenu
          row={props.row}
          onActivate={() => props.onActivate()}
          onQuickLook={() => {
            props.onFocus();
            inspector.open('preview');
          }}
          onStartRename={startRename}
        />
      </div>
    </div>
  );
}

function FileGridCard(props: {
  row: DriveDisplayRow;
  focused: boolean;
  selected: boolean;
  selectedEntities: () => EntityData[];
  onClearSelection: () => void;
  splitId: string;
  onFocus: () => void;
  onToggleSelect: (shiftKey: boolean) => void;
  onActivate: (event?: MouseEvent) => void;
}) {
  const { actions } = useDriveView();
  const { inlineEdit, inspector, host } = useDriveRedesign();
  const isShared = () => {
    const ownerId =
      'ownerId' in props.row.entity ? props.row.entity.ownerId : undefined;
    const viewerId = actions.userId();
    return Boolean(ownerId && viewerId && ownerId !== viewerId);
  };
  const starred = () => host.isStarred(props.row.entity);
  const kind = () => driveItemKind(props.row.entity);
  const fileType = () =>
    'fileType' in props.row.entity ? props.row.entity.fileType : undefined;
  const ownerId = () =>
    'ownerId' in props.row.entity ? props.row.entity.ownerId : undefined;
  const updatedAt = () =>
    props.row.entity.type === 'database' || props.row.entity.type === 'form'
      ? props.row.entity.createdAt
      : props.row.entity.updatedAt;

  const attachDrag = createEntityDraggable({
    get entity() {
      return props.row.entity;
    },
    splitId: props.splitId,
    instanceKey: 'grid-file',
    selection: {
      entities: () =>
        props.selected ? props.selectedEntities() : [props.row.entity],
      selected: props.selectedEntities,
      clear: props.onClearSelection,
    },
  });

  const isRenamingHere = () => {
    const target = inlineEdit.renaming();
    return target?.surface === 'grid' && target.id === props.row.id;
  };

  const startRename = () => {
    if (!host.canMutateEntity(props.row.entity)) return;
    inlineEdit.startRename({
      id: props.row.id,
      name: props.row.entity.name,
      isFolder: false,
      surface: 'grid',
    });
  };

  return (
    <div
      ref={(el) => attachDrag(el)}
      role="gridcell"
      aria-selected={props.selected}
      data-drive-card-id={props.row.id}
      class={cn(
        'group/card relative flex min-w-0 flex-col overflow-hidden rounded-xl border transition-colors select-none',
        props.selected
          ? 'border-accent bg-accent/10'
          : props.focused
            ? 'border-edge-focus bg-panel ring-1 ring-edge-focus/40'
            : 'border-edge-muted bg-panel hover:border-edge'
      )}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          props.onFocus();
          props.onToggleSelect(event.shiftKey);
          return;
        }
        props.onFocus();
        props.onActivate(event);
      }}
    >
      {/* Visual preview stage */}
      <div class="relative flex h-28 w-full items-center justify-center border-b border-edge-muted/70 bg-inset/60">
        {/* Decorative miniature document sheet framing the entity icon */}
        <div class="flex size-14 flex-col items-center justify-center rounded-xl border border-edge-muted bg-surface shadow-xs transition-transform duration-150 group-hover/card:scale-105">
          <span class="size-7">
            <EntityRowIcon entity={props.row.entity} />
          </span>
        </div>

        <span class="absolute right-2.5 bottom-2 rounded-md border border-edge-muted bg-surface/90 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-muted">
          {driveKindExtensionBadge(kind(), fileType())}
        </span>

        {/* Top-left selection checkbox */}
        <div
          class={cn(
            'absolute top-2 left-2 flex size-6 items-center justify-center rounded-md bg-surface/85 backdrop-blur-xs transition-opacity',
            props.selected
              ? 'opacity-100'
              : 'opacity-0 group-hover/card:opacity-100 focus-within:opacity-100'
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <MultiSelectCheckbox
            checked={props.selected}
            onChecked={(_checked, shiftKey) =>
              props.onToggleSelect(Boolean(shiftKey))
            }
          />
        </div>

        {/* Top-right Quick Look, Star, More actions */}
        <div
          class="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('drive.quickLook')}
            tooltip={`${t('drive.quickLook')} (Space)`}
            class="bg-surface/85 backdrop-blur-xs"
            onClick={() => {
              props.onFocus();
              inspector.open('preview');
            }}
          >
            <EyeIcon class="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={starred() ? t('drive.unstar') : t('drive.star')}
            class="bg-surface/85 backdrop-blur-xs"
            onClick={() =>
              fireAndForget(
                host.toggleStarEntities([props.row.entity]),
                'drive-grid-star'
              )
            }
          >
            <Show
              when={starred()}
              fallback={<StarIcon class="size-3.5" aria-hidden="true" />}
            >
              <StarFillIcon class="size-3.5 text-warning" aria-hidden="true" />
            </Show>
          </Button>
          <GridCardMenu
            row={props.row}
            onActivate={() => props.onActivate()}
            onQuickLook={() => {
              props.onFocus();
              inspector.open('preview');
            }}
            onStartRename={startRename}
          />
        </div>
      </div>

      {/* Card footer metadata */}
      <div class="flex min-w-0 flex-col gap-1.5 p-3">
        <Show
          when={isRenamingHere()}
          fallback={
            <Tooltip label={props.row.entity.name} class="min-w-0 max-w-full">
              <div class="line-clamp-2 min-h-[2.25rem] text-sm leading-snug font-medium text-ink">
                {props.row.entity.name}
              </div>
            </Tooltip>
          }
        >
          <InlineNameInput
            initialValue={props.row.entity.name}
            isFolder={false}
            ariaLabel={t('drive.renameInputLabel', {
              name: props.row.entity.name,
            })}
            disabled={inlineEdit.isPending()}
            onCommit={(nextName) =>
              inlineEdit.runCommit(async () => {
                await host.renameEntityInline(props.row.entity, nextName);
              })
            }
            onCancel={inlineEdit.cancelRename}
          />
        </Show>

        <div class="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
          <div class="flex min-w-0 items-center gap-1.5">
            <OwnerLabel
              ownerId={ownerId()}
              iconOnly
              iconClass="size-4"
              suppressClick
            />
            <span class="truncate">{driveKindLabel(kind())}</span>
            <Show when={isShared()}>
              <span class="shrink-0">· {t('drive.sharedLabel')}</span>
            </Show>
          </div>
          <Show when={updatedAt()}>
            {(date) => (
              <span class="shrink-0 tabular-nums">
                {formatRelativeTimestamp(date())}
              </span>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

export function DriveRedesignGrid(props: { onStartInlineFolder: () => void }) {
  const { state, source, sidebar, actions } = useDriveView();
  const {
    preferences,
    inlineEdit,
    inspector,
    host,
    setInspectedEntity,
    setSelectedEntities,
    registerClearSelection,
  } = useDriveRedesign();
  const display = useDriveDisplayItems();
  const panel = useSplitPanelOrThrow();
  const createDropTarget = createFolderDropTargets({
    onMove: host.moveEntitiesWithUndo,
  });

  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [viewportRef, setViewportRef] = createSignal<HTMLDivElement>();
  createScrollTopFade(viewportRef);
  const containerSize = createElementSize(containerRef);

  const [focusedId, setFocusedId] = createSignal<string | undefined>();
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());

  createEffect(() => {
    state.value().location;
    setSelectedIds(new Set<string>());
  });

  const rows = display.items;
  const splitBands = createMemo(() => {
    if (!preferences.foldersFirst()) {
      return { folders: [] as DriveDisplayRow[], files: rows() };
    }
    const { folders, files } = partitionFoldersAndFiles(
      rows().map((row) => ({ ...row, type: row.entity.type }))
    );
    return {
      folders: folders as DriveDisplayRow[],
      files: files as DriveDisplayRow[],
    };
  });

  // Flat ordered sequence matching visual order for 2D keyboard navigation.
  const visualRows = createMemo(() => [
    ...splitBands().folders,
    ...splitBands().files,
  ]);

  const estimatedColumns = () => {
    const width = containerSize.width ?? 800;
    return Math.max(1, Math.floor((width - 32) / 224));
  };

  const selectedRowEntities = createMemo(() => {
    const ids = selectedIds();
    if (ids.size === 0) return [];
    return visualRows()
      .filter((row) => ids.has(row.id))
      .map((row) => row.entity);
  });

  createEffect(() => {
    setSelectedEntities(selectedRowEntities());
  });

  createEffect(() => {
    const list = visualRows();
    if (list.length === 0) {
      setFocusedId(undefined);
      setInspectedEntity(undefined);
      return;
    }
    const existing = list.find((row) => row.id === focusedId());
    if (existing) {
      setInspectedEntity(existing.entity);
    } else {
      setFocusedId(list[0].id);
      setInspectedEntity(list[0].entity);
    }
  });

  const clearSelection = () => setSelectedIds(new Set<string>());
  onCleanup(() => {
    setSelectedEntities([]);
  });
  onCleanup(registerClearSelection(clearSelection));

  const toggleSelect = (id: string, shiftKey: boolean) => {
    const next = new Set(selectedIds());
    if (shiftKey && focusedId()) {
      const list = visualRows();
      const a = list.findIndex((row) => row.id === focusedId());
      const b = list.findIndex((row) => row.id === id);
      if (a >= 0 && b >= 0) {
        const [start, end] = a < b ? [a, b] : [b, a];
        for (let i = start; i <= end; i += 1) next.add(list[i].id);
        setSelectedIds(next);
        return;
      }
    }
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const navigateUpOneLevel = () => {
    const activeId = state.projectId();
    if (!activeId) return false;
    const ancestors = folderAncestors(sidebar.folders(), activeId);
    const parent =
      ancestors.length > 1 ? ancestors[ancestors.length - 2] : undefined;
    if (parent) state.selectFolder(parent.id);
    else state.selectTab('owned');
    return true;
  };

  const handleGlobalGridShortcut = (
    event: KeyboardEvent,
    list: readonly DriveDisplayRow[]
  ): boolean => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      fireAndForget(host.undoLatestWithToast(), 'drive-grid-undo');
      return true;
    }
    if (mod && key === 'a') {
      event.preventDefault();
      setSelectedIds(new Set(list.map((row) => row.id)));
      return true;
    }
    if (mod && event.shiftKey && key === 'n') {
      event.preventDefault();
      props.onStartInlineFolder();
      return true;
    }
    if (mod && event.key === 'ArrowUp') {
      if (navigateUpOneLevel()) event.preventDefault();
      return true;
    }
    if (event.key === 'Escape') {
      if (selectedIds().size > 0) {
        event.preventDefault();
        clearSelection();
      } else if (inspector.isOpen()) {
        event.preventDefault();
        inspector.close();
      }
      return true;
    }
    return false;
  };

  const handleGridItemShortcut = (
    event: KeyboardEvent,
    focusedRow: DriveDisplayRow | undefined
  ) => {
    if (!focusedRow) return;
    const nestedControl = (event.target as HTMLElement | null)?.closest(
      'button, a, [role="checkbox"], [role="radio"], [role="menuitem"]'
    );
    if (event.key === ' ') {
      if (nestedControl) return;
      event.preventDefault();
      setInspectedEntity(focusedRow.entity);
      inspector.toggle();
      return;
    }
    if (event.key === 'Enter') {
      if (nestedControl) return;
      event.preventDefault();
      actions.openEntity(
        focusedRow.entity,
        undefined,
        undefined,
        event.shiftKey
      );
      return;
    }
    if (event.key === 'F2' && host.canMutateEntity(focusedRow.entity)) {
      event.preventDefault();
      inlineEdit.startRename({
        id: focusedRow.id,
        name: focusedRow.entity.name,
        isFolder: focusedRow.isFolder,
        surface: 'grid',
      });
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const targets =
        selectedRowEntities().length > 0
          ? selectedRowEntities()
          : [focusedRow.entity];
      const mutable = targets.filter((entity) => host.canMutateEntity(entity));
      if (mutable.length === 0) return;
      event.preventDefault();
      clearSelection();
      fireAndForget(host.trashEntitiesWithUndo(mutable), 'drive-grid-trash');
    }
  };

  const GRID_DIR_MAP: Record<
    string,
    'left' | 'right' | 'up' | 'down' | 'home' | 'end'
  > = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Home: 'home',
    End: 'end',
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      inlineEdit.isEditing() ||
      isEditableInput(event.target as Element)
    ) {
      return;
    }
    const list = visualRows();
    if (handleGlobalGridShortcut(event, list) || list.length === 0) return;

    const idx = list.findIndex((row) => row.id === focusedId());
    const moveDir = GRID_DIR_MAP[event.key];
    if (moveDir) {
      event.preventDefault();
      const nextIndex = gridNextIndex(
        idx,
        list.length,
        estimatedColumns(),
        moveDir
      );
      const target = list[nextIndex];
      if (target) {
        setFocusedId(target.id);
        setInspectedEntity(target.entity);
        containerRef()
          ?.querySelector(`[data-drive-card-id="${CSS.escape(target.id)}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }

    handleGridItemShortcut(event, idx >= 0 ? list[idx] : undefined);
  };

  const isCreatingInlineHere = () =>
    inlineEdit.creatingFolder()?.surface === 'grid';

  const dragSelection = {
    entities: () => {
      const selected = selectedRowEntities();
      const focused = visualRows().find(
        (row) => row.id === focusedId()
      )?.entity;
      return selected.length > 0 ? selected : focused ? [focused] : [];
    },
    selected: () => selectedRowEntities(),
    clear: clearSelection,
  };

  const emptyReason = () => {
    if (source.error() && !source.hasData()) return 'error' as const;
    if (display.isSearching()) return 'search' as const;
    if (display.hasFilters()) return 'filters' as const;
    if (state.projectId()) return 'folder' as const;
    if (display.isSharedTab()) return 'shared' as const;
    if (display.isRecentTab()) return 'recent' as const;
    return 'my-drive' as const;
  };

  return (
    <EntityDragSelectionContext.Provider value={dragSelection}>
      <div
        ref={setContainerRef}
        role="grid"
        aria-label="Drive files"
        aria-multiselectable="true"
        tabIndex={0}
        class="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
        onKeyDown={handleKeyDown}
      >
        <Switch>
          <Match when={source.isLoading() && visualRows().length === 0}>
            <DriveContentSkeleton mode="grid" />
          </Match>
          <Match when={visualRows().length === 0 && !isCreatingInlineHere()}>
            <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
              <DriveRedesignEmptyState
                reason={emptyReason()}
                isInFolder={Boolean(state.projectId())}
                onCreateDocument={() => host.createNewItem('md')}
                onCreateFolder={props.onStartInlineFolder}
                onClearFilters={state.clearFilters}
                onClearSearch={() => state.setSearch('')}
                onSearchAllDrive={() => {
                  const query = state.value().search;
                  state.selectTab('owned');
                  state.setSearch(query);
                }}
                onBackToDrive={() => state.selectTab('owned')}
                onRetry={() =>
                  fireAndForget(
                    (async () => {
                      try {
                        await source.refresh();
                      } catch {
                        toast.failure(t('drive.loadFailed'));
                      }
                    })(),
                    'drive-grid-retry'
                  )
                }
              />
              <Show when={source.hasMore() && !source.isLoadingMore()}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    fireAndForget(source.loadMore(), 'drive-grid-empty-more')
                  }
                >
                  {t('drive.loadMore')}
                </Button>
              </Show>
            </div>
          </Match>
          <Match when={true}>
            <div
              ref={setViewportRef}
              class="min-h-0 flex-1 overflow-y-auto overscroll-none p-4"
            >
              {/* Folders Band */}
              <Show
                when={splitBands().folders.length > 0 || isCreatingInlineHere()}
              >
                <section class="mb-6">
                  <div class="mb-2.5 flex items-center justify-between">
                    <h2 class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                      {t('drive.folders')}
                    </h2>
                    <span class="text-xs tabular-nums text-ink-subtle">
                      {splitBands().folders.length}
                    </span>
                  </div>
                  <div class="grid grid-cols-[repeat(auto-fill,minmax(216px,1fr))] gap-2.5">
                    <Show when={isCreatingInlineHere()}>
                      <div class="flex h-14 items-center gap-2.5 rounded-xl border border-accent bg-accent/5 px-3">
                        <FolderPlusIcon
                          class="size-5 shrink-0 text-accent"
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
                              await host.createFolderInline(
                                name,
                                inlineEdit.creatingFolder()?.parentId ?? null
                              );
                            })
                          }
                          onCancel={inlineEdit.cancelCreateFolder}
                        />
                      </div>
                    </Show>
                    <Key each={splitBands().folders} by="id">
                      {(row) => (
                        <FolderGridCard
                          row={row()}
                          focused={focusedId() === row().id}
                          selected={selectedIds().has(row().id)}
                          selectedEntities={selectedRowEntities}
                          onClearSelection={clearSelection}
                          splitId={panel.handle.id}
                          createDropTarget={createDropTarget}
                          onFocus={() => {
                            const current = row();
                            setFocusedId(current.id);
                            setInspectedEntity(current.entity);
                          }}
                          onToggleSelect={(shift) =>
                            toggleSelect(row().id, shift)
                          }
                          onActivate={(event) =>
                            actions.openEntity(row().entity, event)
                          }
                        />
                      )}
                    </Key>
                  </div>
                </section>
              </Show>

              {/* Files Band */}
              <Show when={splitBands().files.length > 0}>
                <section>
                  <Show when={splitBands().folders.length > 0}>
                    <div class="mb-2.5 flex items-center justify-between">
                      <h2 class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                        {t('drive.filesSection')}
                      </h2>
                      <span class="text-xs tabular-nums text-ink-subtle">
                        {splitBands().files.length}
                      </span>
                    </div>
                  </Show>
                  <div class="grid grid-cols-[repeat(auto-fill,minmax(216px,1fr))] gap-3">
                    <Key each={splitBands().files} by="id">
                      {(row) => (
                        <Show
                          when={row().isFolder}
                          fallback={
                            <FileGridCard
                              row={row()}
                              focused={focusedId() === row().id}
                              selected={selectedIds().has(row().id)}
                              selectedEntities={selectedRowEntities}
                              onClearSelection={clearSelection}
                              splitId={panel.handle.id}
                              onFocus={() => {
                                const current = row();
                                setFocusedId(current.id);
                                setInspectedEntity(current.entity);
                              }}
                              onToggleSelect={(shift) =>
                                toggleSelect(row().id, shift)
                              }
                              onActivate={(event) =>
                                actions.openEntity(row().entity, event)
                              }
                            />
                          }
                        >
                          <FolderGridCard
                            row={row()}
                            focused={focusedId() === row().id}
                            selected={selectedIds().has(row().id)}
                            selectedEntities={selectedRowEntities}
                            onClearSelection={clearSelection}
                            splitId={panel.handle.id}
                            createDropTarget={createDropTarget}
                            onFocus={() => {
                              const current = row();
                              setFocusedId(current.id);
                              setInspectedEntity(current.entity);
                            }}
                            onToggleSelect={(shift) =>
                              toggleSelect(row().id, shift)
                            }
                            onActivate={(event) =>
                              actions.openEntity(row().entity, event)
                            }
                          />
                        </Show>
                      )}
                    </Key>
                  </div>
                </section>
              </Show>

              <Show when={source.isLoadingMore()}>
                <div
                  role="status"
                  class="flex items-center justify-center gap-2 py-5 text-xs text-ink-muted"
                >
                  <SpinnerIcon
                    class="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  <span>{t('drive.loadingMore')}</span>
                </div>
              </Show>
              <Show when={source.hasMore() && !source.isLoadingMore()}>
                <div class="flex justify-center py-5">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      fireAndForget(source.loadMore(), 'drive-grid-load-more')
                    }
                  >
                    {t('drive.loadMore')}
                  </Button>
                </div>
              </Show>
              <div class="h-16" aria-hidden="true" />
            </div>
          </Match>
        </Switch>

        <DriveSelectionToolbar
          selected={selectedRowEntities()}
          canTrash={selectedRowEntities().some((entity) =>
            host.canMutateEntity(entity)
          )}
          allStarred={
            selectedRowEntities().length > 0 &&
            selectedRowEntities().every((entity) => host.isStarred(entity))
          }
          onClear={clearSelection}
          onMove={() => host.openMoveDialog(selectedRowEntities())}
          onToggleStar={() =>
            fireAndForget(
              host.toggleStarEntities(selectedRowEntities()),
              'drive-grid-bulk-star'
            )
          }
          onShare={() => host.shareEntities(selectedRowEntities())}
          onDuplicate={() =>
            fireAndForget(
              host.duplicateEntities(selectedRowEntities()),
              'drive-grid-bulk-dup'
            )
          }
          onTrash={() => {
            const targets = selectedRowEntities();
            clearSelection();
            fireAndForget(
              host.trashEntitiesWithUndo(targets),
              'drive-grid-bulk-trash'
            );
          }}
        />
      </div>
    </EntityDragSelectionContext.Provider>
  );
}
