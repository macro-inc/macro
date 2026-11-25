import { createListController } from '@app/components/list';
import {
  createFolderDropTargets,
  resolveEntityActionViewContext,
  toEntityActionListState,
} from '@app/features/next-soup/actions';
import { SoupEntityContextMenu } from '@app/features/soup';
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
  isProjectContainedEntity,
  MultiSelectCheckbox,
  OwnerLabel,
  ProjectBreadCrumb,
} from '@entity';
import ShareIcon from '@icon/share.svg';
import StarFillIcon from '@icon/system/fill/star-fill.svg';
import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CaretUpDownIcon from '@icon/system/regular/caret-up-down.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import EyeIcon from '@icon/system/regular/eye.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, cn, Dropdown, Tooltip } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  DriveContentSkeleton,
  DriveRedesignEmptyState,
} from '../../components/redesign/drive-empty-state';
import { DriveSelectionToolbar } from '../../components/redesign/drive-selection-toolbar';
import { InlineNameInput } from '../../components/redesign/inline-name-input';
import { driveKindLabel } from '../../components/redesign/kind-label';
import { ShareProvenanceBadge } from '../../components/redesign/share-provenance-badge';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import {
  type DriveTimeBucketId,
  driveItemKind,
  groupByTimeBucket,
  orderDriveDisplayItems,
} from '../../core/drive-items';
import { folderAncestors } from '../../core/folder-tree';
import type { DriveSort } from '../../core/types';
import {
  type DriveDisplayRow,
  useDriveDisplayItems,
} from '../shared/use-drive-display-items';

const MAX_INLINE_EXPAND_DEPTH = 3;

function timeBucketLabel(bucket: DriveTimeBucketId): string {
  switch (bucket) {
    case 'today':
      return t('drive.bucketToday');
    case 'yesterday':
      return t('drive.bucketYesterday');
    case 'this_week':
      return t('drive.bucketThisWeek');
    case 'earlier':
      return t('drive.bucketEarlier');
  }
}

function entityTimestamp(
  entity: EntityData,
  sort: DriveSort,
  isRecent: boolean
) {
  const raw = (() => {
    if (entity.type === 'database' || entity.type === 'form') {
      return entity.createdAt;
    }
    if (isRecent && 'touchedAt' in entity && entity.touchedAt) {
      return entity.touchedAt;
    }
    if ('sortTs' in entity && entity.sortTs) return entity.sortTs;
    if (sort === 'created_at') return entity.createdAt;
    if (sort === 'viewed_at' && 'viewedAt' in entity) return entity.viewedAt;
    return entity.updatedAt;
  })();
  if (raw == null) return undefined;
  return typeof raw === 'number' ? new Date(raw) : raw;
}

function InlineExpandedFolderChildren(props: {
  folderId: string;
  depth: number;
  expandedIds: ReadonlySet<string>;
  onToggleExpand: (folderId: string) => void;
  showLocationColumn: boolean;
  isRecent: boolean;
  sort: DriveSort;
  focusedId: string | undefined;
  selectedIds: ReadonlySet<string>;
  onFocus: (entity: EntityData) => void;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onActivate: (entity: EntityData, event?: MouseEvent) => void;
  createDropTarget?: ReturnType<typeof createFolderDropTargets>;
  splitId: string;
}) {
  const { preferences, createFolderContents } = useDriveRedesign();
  const display = useDriveDisplayItems();
  const childSource = createFolderContents(() => props.folderId);

  const childRows = createMemo<DriveDisplayRow[]>(() => {
    const ordered = orderDriveDisplayItems(
      childSource.items().map((row) => row.entity),
      {
        foldersFirst: preferences.foldersFirst(),
        sort: props.sort,
        direction: preferences.sortDirection(),
      }
    );
    const counts = display.subfolderCounts();
    return ordered.map((entity) => ({
      id: entity.id,
      entity,
      isFolder: entity.type === 'project',
      subfolderCount:
        entity.type === 'project' ? (counts.get(entity.id) ?? 0) : 0,
    }));
  });

  const indentPx = () => props.depth * 24;

  return (
    <div class="relative">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute top-0 bottom-1 w-px bg-edge-muted"
        style={{ left: `${indentPx() + 26}px` }}
      />
      <Show
        when={!childSource.isLoading() || childRows().length > 0}
        fallback={
          <div
            class="flex h-9 items-center gap-2 text-xs text-ink-muted"
            style={{ 'padding-left': `${indentPx() + 44}px` }}
          >
            <SpinnerIcon class="size-3 animate-spin" aria-hidden="true" />
            <span>{t('drive.loadingMore')}</span>
          </div>
        }
      >
        <Show
          when={!childSource.error() || childRows().length > 0}
          fallback={
            <div
              class="flex h-9 items-center gap-2 text-xs text-ink-muted"
              style={{ 'padding-left': `${indentPx() + 44}px` }}
            >
              <span>{t('drive.loadFailed')}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  fireAndForget(childSource.refresh(), 'drive-expanded-retry')
                }
              >
                {t('drive.tryAgain')}
              </Button>
            </div>
          }
        >
          <Show
            when={childRows().length > 0}
            fallback={
              <div
                class="flex h-9 items-center text-xs text-ink-subtle"
                style={{ 'padding-left': `${indentPx() + 44}px` }}
              >
                {t('drive.columnEmpty')}
              </div>
            }
          >
            <Key each={childRows()} by="id">
              {(row) => (
                <DriveListRowItem
                  row={row()}
                  depth={props.depth}
                  expandedIds={props.expandedIds}
                  onToggleExpand={props.onToggleExpand}
                  showLocationColumn={props.showLocationColumn}
                  isRecent={props.isRecent}
                  sort={props.sort}
                  focused={props.focusedId === row().id}
                  selected={props.selectedIds.has(row().id)}
                  selectedEntities={() => []}
                  onClearSelection={() => {}}
                  onFocus={props.onFocus}
                  onToggleSelect={props.onToggleSelect}
                  onActivate={props.onActivate}
                  createDropTarget={props.createDropTarget}
                  splitId={props.splitId}
                />
              )}
            </Key>
          </Show>
          <Show when={childSource.isLoadingMore()}>
            <div
              role="status"
              class="flex h-9 items-center gap-2 text-xs text-ink-muted"
              style={{ 'padding-left': `${indentPx() + 44}px` }}
            >
              <SpinnerIcon class="size-3 animate-spin" aria-hidden="true" />
              <span>{t('drive.loadingMore')}</span>
            </div>
          </Show>
          <Show when={childSource.hasMore() && !childSource.isLoadingMore()}>
            <div
              class="flex h-9 items-center"
              style={{ 'padding-left': `${indentPx() + 40}px` }}
            >
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  fireAndForget(
                    childSource.loadMore(),
                    'drive-expanded-load-more'
                  )
                }
              >
                {t('drive.loadMore')}
              </Button>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function DriveListRowItem(props: {
  row: DriveDisplayRow;
  depth: number;
  expandedIds: ReadonlySet<string>;
  onToggleExpand: (folderId: string) => void;
  showLocationColumn: boolean;
  isRecent: boolean;
  sort: DriveSort;
  focused: boolean;
  selected: boolean;
  selectedEntities: () => EntityData[];
  onClearSelection: () => void;
  onFocus: (entity: EntityData) => void;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onActivate: (entity: EntityData, event?: MouseEvent) => void;
  createDropTarget?: ReturnType<typeof createFolderDropTargets>;
  splitId: string;
}) {
  const { actions } = useDriveView();
  const { inlineEdit, inspector, host, shareProvenance } = useDriveRedesign();
  const isShared = () => {
    const ownerId =
      'ownerId' in props.row.entity ? props.row.entity.ownerId : undefined;
    const viewerId = actions.userId();
    return Boolean(ownerId && viewerId && ownerId !== viewerId);
  };
  const provenance = () =>
    isShared() ? shareProvenance?.get(props.row.entity) : undefined;

  const isExpanded = () =>
    props.row.isFolder && props.expandedIds.has(props.row.id);
  const canExpand = () =>
    props.row.isFolder && props.depth < MAX_INLINE_EXPAND_DEPTH;
  const isRenamingHere = () => {
    const target = inlineEdit.renaming();
    return target?.surface === 'list' && target.id === props.row.id;
  };
  const starred = () => host.isStarred(props.row.entity);
  const canMutate = () => host.canMutateEntity(props.row.entity);
  const kind = () => driveItemKind(props.row.entity);
  const ts = () =>
    entityTimestamp(props.row.entity, props.sort, props.isRecent);

  const dropTarget = props.row.isFolder
    ? props.createDropTarget?.(() => props.row.id)
    : undefined;

  const attachDrag = createEntityDraggable({
    get entity() {
      return props.row.entity;
    },
    splitId: props.splitId,
    instanceKey: props.depth > 0 ? `list-nested-${props.depth}` : 'list',
    selection: {
      entities: () =>
        props.depth === 0 && props.selected
          ? props.selectedEntities()
          : [props.row.entity],
      selected: () => (props.depth === 0 ? props.selectedEntities() : []),
      clear: props.onClearSelection,
    },
  });

  const ownerId = () =>
    'ownerId' in props.row.entity ? props.row.entity.ownerId : undefined;
  const projectEntity = createMemo(() =>
    isProjectContainedEntity(props.row.entity) ? props.row.entity : undefined
  );

  const startRename = () => {
    if (!canMutate()) return;
    inlineEdit.startRename({
      id: props.row.id,
      name: props.row.entity.name,
      isFolder: props.row.isFolder,
      surface: 'list',
    });
  };

  return (
    <div>
      <div
        ref={(el) => {
          dropTarget?.ref(el);
          attachDrag(el);
        }}
        role="row"
        aria-selected={props.selected}
        data-drive-row-id={props.row.id}
        data-focused={props.focused ? 'true' : undefined}
        class={cn(
          'group/row relative flex h-11 min-w-0 items-center gap-2 border-b border-edge-muted/60 px-3 text-sm transition-colors select-none',
          props.selected
            ? 'bg-accent/10'
            : props.focused
              ? 'bg-hover/80'
              : 'hover:bg-hover/60',
          dropTarget?.isOver() &&
            'bg-accent/14 outline-2 -outline-offset-2 outline-accent'
        )}
        style={
          props.depth > 0
            ? { 'padding-left': `${12 + props.depth * 24}px` }
            : undefined
        }
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            props.onFocus(props.row.entity);
            props.onToggleSelect(props.row.id, event.shiftKey);
            return;
          }
          props.onFocus(props.row.entity);
          props.onActivate(props.row.entity, event);
        }}
      >
        {/* Checkbox */}
        <div
          class={cn(
            'flex size-5 shrink-0 items-center justify-center transition-opacity',
            props.selected
              ? 'opacity-100'
              : 'opacity-0 group-hover/row:opacity-100 focus-within:opacity-100'
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <MultiSelectCheckbox
            checked={props.selected}
            onChecked={(_checked, shiftKey) =>
              props.onToggleSelect(props.row.id, Boolean(shiftKey))
            }
          />
        </div>

        {/* Inline folder expand chevron */}
        <div class="flex size-5 shrink-0 items-center justify-center">
          <Show when={canExpand()}>
            <button
              type="button"
              aria-label={
                isExpanded()
                  ? t('drive.collapseFolder', { name: props.row.entity.name })
                  : t('drive.expandFolder', { name: props.row.entity.name })
              }
              aria-expanded={isExpanded()}
              class="inline-flex size-5 items-center justify-center rounded text-ink-muted transition-colors hover:bg-active hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              onClick={(event) => {
                event.stopPropagation();
                props.onFocus(props.row.entity);
                props.onToggleExpand(props.row.id);
              }}
            >
              <CaretRightIcon
                class={cn(
                  'size-3 transition-transform duration-150',
                  isExpanded() && 'rotate-90'
                )}
                aria-hidden="true"
              />
            </button>
          </Show>
        </div>

        {/* Icon + Title / Inline Rename */}
        <div class="flex min-w-0 flex-1 items-center gap-2.5">
          <span class="flex size-5 shrink-0 items-center justify-center">
            <EntityRowIcon entity={props.row.entity} />
          </span>
          <Show
            when={isRenamingHere()}
            fallback={
              <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <Tooltip
                  label={props.row.entity.name}
                  class="min-w-0 max-w-full"
                >
                  <span
                    class={cn(
                      'min-w-0 truncate',
                      props.row.isFolder ? 'font-medium text-ink' : 'text-ink'
                    )}
                  >
                    {props.row.entity.name || t('drive.folderNamePlaceholder')}
                  </span>
                </Tooltip>
                <Show when={props.row.isFolder && props.row.subfolderCount > 0}>
                  <span class="shrink-0 rounded-full bg-inset px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-muted">
                    {t('drive.subfolderCount', {
                      count: props.row.subfolderCount,
                    })}
                  </span>
                </Show>
                <Show when={isShared()}>
                  <ShareProvenanceBadge
                    provenance={provenance()}
                    fallbackShared
                  />
                </Show>
                <Show when={starred()}>
                  <StarFillIcon
                    class="size-3 shrink-0 text-warning"
                    aria-label={t('drive.starred')}
                  />
                </Show>
              </div>
            }
          >
            <InlineNameInput
              initialValue={props.row.entity.name}
              isFolder={props.row.isFolder}
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
        </div>

        {/* Location column (flat views) */}
        <Show when={props.showLocationColumn}>
          <div
            class="hidden w-36 shrink-0 items-center overflow-hidden text-xs text-ink-muted @min-[760px]/drive-list:flex"
            onClick={(event) => event.stopPropagation()}
          >
            <Show
              when={projectEntity()}
              fallback={
                <span class="truncate px-2 text-ink-subtle">
                  {t('drive.unfiledLocation')}
                </span>
              }
            >
              {(contained) => (
                <ProjectBreadCrumb
                  entity={contained()}
                  onClick={(project, event) =>
                    actions.openEntity(project, event)
                  }
                />
              )}
            </Show>
          </div>
        </Show>

        {/* Kind column */}
        <div class="hidden w-24 shrink-0 truncate text-xs text-ink-muted @min-[640px]/drive-list:block">
          {driveKindLabel(kind())}
        </div>

        {/* Owner column */}
        <div
          class="hidden w-28 shrink-0 items-center overflow-hidden text-xs text-ink-muted @min-[880px]/drive-list:flex"
          onClick={(event) => event.stopPropagation()}
        >
          <OwnerLabel
            ownerId={ownerId()}
            viewerLabel={t('drive.ownerYou')}
            iconClass="size-4"
            suppressClick
          />
        </div>

        {/* Modified timestamp */}
        <div class="hidden w-24 shrink-0 text-right text-xs tabular-nums text-ink-muted @min-[520px]/drive-list:block">
          <Show when={ts()}>{(date) => formatRelativeTimestamp(date())}</Show>
        </div>

        {/* Hover quick actions */}
        <div
          class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('drive.quickLook')}
            tooltip={`${t('drive.quickLook')} (Space)`}
            onClick={() => {
              props.onFocus(props.row.entity);
              inspector.open('preview');
            }}
          >
            <EyeIcon class="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={starred() ? t('drive.unstar') : t('drive.star')}
            tooltip={starred() ? t('drive.unstar') : t('drive.star')}
            onClick={() =>
              fireAndForget(
                host.toggleStarEntities([props.row.entity]),
                'drive-row-star'
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
          <Dropdown placement="bottom-end">
            <Dropdown.Trigger
              as={Button}
              variant="ghost"
              size="icon-xs"
              aria-label={t('drive.moreActions')}
              tooltip={t('drive.moreActions')}
            >
              <DotsIcon class="size-3.5" aria-hidden="true" />
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-44">
              <Dropdown.Item
                onSelect={() => props.onActivate(props.row.entity)}
              >
                <span>
                  {props.row.isFolder
                    ? t('drive.openFolder')
                    : t('drive.openFullView')}
                </span>
              </Dropdown.Item>
              <Dropdown.Item
                onSelect={() => {
                  props.onFocus(props.row.entity);
                  inspector.open('preview');
                }}
              >
                <EyeIcon class="size-3.5 shrink-0" aria-hidden="true" />
                <span>{t('drive.quickLook')}</span>
              </Dropdown.Item>
              <Show when={canMutate()}>
                <Dropdown.Item onSelect={startRename}>
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
              <Dropdown.Item
                onSelect={() => host.shareEntities([props.row.entity])}
              >
                <ShareIcon class="size-3.5 shrink-0" aria-hidden="true" />
                <span>{t('drive.share')}</span>
              </Dropdown.Item>
              <Dropdown.Item
                onSelect={() =>
                  fireAndForget(
                    host.duplicateEntities([props.row.entity]),
                    'drive-row-dup'
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
                      'drive-row-trash'
                    )
                  }
                >
                  <TrashIcon class="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('drive.moveToTrash')}</span>
                </Dropdown.Item>
              </Show>
            </Dropdown.Content>
          </Dropdown>
        </div>
      </div>

      <Show when={isExpanded()}>
        <InlineExpandedFolderChildren
          folderId={props.row.id}
          depth={props.depth + 1}
          expandedIds={props.expandedIds}
          onToggleExpand={props.onToggleExpand}
          showLocationColumn={props.showLocationColumn}
          isRecent={props.isRecent}
          sort={props.sort}
          focusedId={props.focused ? props.row.id : undefined}
          selectedIds={new Set()}
          onFocus={props.onFocus}
          onToggleSelect={props.onToggleSelect}
          onActivate={props.onActivate}
          createDropTarget={props.createDropTarget}
          splitId={props.splitId}
        />
      </Show>
    </div>
  );
}

export function DriveRedesignList(props: { onStartInlineFolder: () => void }) {
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

  const [gridRef, setGridRef] = createSignal<HTMLDivElement>();
  const [viewportRef, setViewportRef] = createSignal<HTMLDivElement>();
  createScrollTopFade(viewportRef);

  const [focusedId, setFocusedId] = createSignal<string | undefined>();
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [selectionAnchorId, setSelectionAnchorId] = createSignal<
    string | undefined
  >();
  const [expandedFolderIds, setExpandedFolderIds] = createSignal<Set<string>>(
    new Set()
  );

  // Reset local selection/expansion when location changes.
  createEffect(() => {
    state.value().location;
    setSelectedIds(new Set<string>());
    setSelectionAnchorId(undefined);
    setExpandedFolderIds(new Set<string>());
  });

  const rows = display.items;

  // Keep inspected & selected entities synced with the redesign context.
  const selectedRowEntities = createMemo(() => {
    const ids = selectedIds();
    if (ids.size === 0) return [];
    return rows()
      .filter((row) => ids.has(row.id))
      .map((row) => row.entity);
  });

  createEffect(() => {
    setSelectedEntities(selectedRowEntities());
  });

  // Maintain valid focus on the first item when rows settle.
  createEffect(() => {
    const list = rows();
    const current = focusedId();
    if (list.length === 0) {
      setFocusedId(undefined);
      setInspectedEntity(undefined);
      return;
    }
    const found = current ? list.find((row) => row.id === current) : undefined;
    if (found) {
      setInspectedEntity(found.entity);
    } else {
      setFocusedId(list[0].id);
      setInspectedEntity(list[0].entity);
    }
  });

  const clearSelection = () => {
    setSelectedIds(new Set<string>());
    setSelectionAnchorId(undefined);
  };

  onCleanup(() => {
    setSelectedEntities([]);
  });
  onCleanup(registerClearSelection(clearSelection));

  const toggleSelect = (id: string, shiftKey: boolean) => {
    const list = rows();
    const next = new Set(selectedIds());
    if (shiftKey && selectionAnchorId()) {
      const anchorIdx = list.findIndex((row) => row.id === selectionAnchorId());
      const targetIdx = list.findIndex((row) => row.id === id);
      if (anchorIdx >= 0 && targetIdx >= 0) {
        const [start, end] =
          anchorIdx < targetIdx
            ? [anchorIdx, targetIdx]
            : [targetIdx, anchorIdx];
        for (let i = start; i <= end; i += 1) {
          next.add(list[i].id);
        }
        setSelectedIds(next);
        return;
      }
    }
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectionAnchorId(id);
    setSelectedIds(next);
  };

  const toggleExpandFolder = (id: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activateEntity = (
    entity: EntityData,
    event?: MouseEvent,
    newSplit?: boolean
  ) => {
    actions.openEntity(entity, event, undefined, newSplit);
  };

  const showLocationColumn = () =>
    !state.projectId() &&
    (preferences.rootMode() === 'all' ||
      display.isRecentTab() ||
      display.isSharedTab() ||
      display.isSearching() ||
      display.hasFilters());

  const handleSortHeaderClick = (sort: DriveSort) => {
    if (state.value().sort === sort) {
      preferences.toggleSortDirection();
    } else {
      state.setSort(sort);
      preferences.setSortDirection(sort === 'name' ? 'asc' : 'desc');
    }
  };

  const checkNearEnd = () => {
    if (source.error() || source.isLoading() || source.isFetching()) return;
    if (!source.hasMore()) return;
    const container = viewportRef();
    if (!container || container.clientHeight === 0) return;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < 320) {
      fireAndForget(source.loadMore(), 'drive-redesign-list-more');
    }
  };

  // Drag selection context so dragging one selected row moves the whole selection.
  const dragSelection = {
    entities: () => {
      const selected = selectedRowEntities();
      const focused = rows().find((row) => row.id === focusedId())?.entity;
      if (selected.length > 0) return selected;
      return focused ? [focused] : [];
    },
    selected: () => selectedRowEntities(),
    clear: clearSelection,
  };

  // Context menu adapter built over a lightweight controller.
  const listController = createListController<DriveDisplayRow>({
    items: rows,
    getKey: (row) => row.id,
    onActivate: ({ item }) => activateEntity(item.entity),
  });
  const actionState = toEntityActionListState({
    controller: listController,
    getEntity: (row) => row.entity,
    onFocus: () => gridRef()?.focus(),
  });
  const actionContext = () =>
    resolveEntityActionViewContext({
      activeListView: 'documents',
      activeTab: 'all',
    });

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

  const handleGlobalListShortcut = (
    event: KeyboardEvent,
    list: readonly DriveDisplayRow[]
  ): boolean => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      fireAndForget(host.undoLatestWithToast(), 'drive-undo-hotkey');
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
      } else if (state.value().search) {
        event.preventDefault();
        state.setSearch('');
      }
      return true;
    }
    return false;
  };

  const focusListIndex = (
    list: readonly DriveDisplayRow[],
    index: number,
    loadMoreNearEnd: boolean
  ) => {
    const target = list[index];
    if (!target) return;
    setFocusedId(target.id);
    setInspectedEntity(target.entity);
    gridRef()
      ?.querySelector(`[data-drive-row-id="${CSS.escape(target.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    if (loadMoreNearEnd && list.length - index <= 5 && source.hasMore()) {
      fireAndForget(source.loadMore(), 'drive-list-keydown-more');
    }
  };

  const handleListItemShortcut = (
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
      activateEntity(focusedRow.entity, undefined, event.shiftKey);
      return;
    }
    if (event.key === 'ArrowRight' && focusedRow.isFolder) {
      event.preventDefault();
      if (!expandedFolderIds().has(focusedRow.id)) {
        toggleExpandFolder(focusedRow.id);
      }
      return;
    }
    if (event.key === 'ArrowLeft' && focusedRow.isFolder) {
      event.preventDefault();
      if (expandedFolderIds().has(focusedRow.id)) {
        toggleExpandFolder(focusedRow.id);
      }
      return;
    }
    if (event.key === 'x') {
      event.preventDefault();
      toggleSelect(focusedRow.id, event.shiftKey);
      return;
    }
    if (event.key === 'F2' && host.canMutateEntity(focusedRow.entity)) {
      event.preventDefault();
      inlineEdit.startRename({
        id: focusedRow.id,
        name: focusedRow.entity.name,
        isFolder: focusedRow.isFolder,
        surface: 'list',
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
      fireAndForget(host.trashEntitiesWithUndo(mutable), 'drive-key-trash');
    }
  };

  // Keyboard navigation handler (Finder + Notion ergonomics).
  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      inlineEdit.isEditing() ||
      isEditableInput(event.target as Element)
    ) {
      return;
    }
    const list = rows();
    if (handleGlobalListShortcut(event, list) || list.length === 0) return;

    const currentIndex = list.findIndex((row) => row.id === focusedId());
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      const nextIdx =
        currentIndex < 0 ? 0 : Math.min(list.length - 1, currentIndex + 1);
      focusListIndex(list, nextIdx, true);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      const prevIdx =
        currentIndex < 0 ? list.length - 1 : Math.max(0, currentIndex - 1);
      focusListIndex(list, prevIdx, false);
      return;
    }
    const focusedRow = currentIndex >= 0 ? list[currentIndex] : undefined;
    handleListItemShortcut(event, focusedRow);
  };

  onMount(() => {
    if (!panel.isPanelActive()) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.isContentEditable || active.matches('input, textarea'))
    ) {
      return;
    }
    gridRef()?.focus({ preventScroll: true });
  });

  const isCreatingInlineHere = () => {
    const target = inlineEdit.creatingFolder();
    return target?.surface === 'list';
  };

  const recentGroups = createMemo(() => {
    if (!display.isRecentTab()) return [];
    return groupByTimeBucket(rows(), (row) =>
      entityTimestamp(row.entity, state.value().sort, true)
    );
  });

  const allSelected = () =>
    rows().length > 0 && selectedIds().size === rows().length;

  const emptyReason = () => {
    if (source.error() && !source.hasData()) return 'error' as const;
    if (display.isSearching()) return 'search' as const;
    if (display.hasFilters()) return 'filters' as const;
    if (state.projectId()) return 'folder' as const;
    if (display.isSharedTab()) return 'shared' as const;
    if (display.isRecentTab()) return 'recent' as const;
    return 'my-drive' as const;
  };

  const renderRowWithContext = (row: Accessor<DriveDisplayRow>) => (
    <SoupEntityContextMenu
      as="div"
      class="h-auto"
      entity={row().entity}
      list={actionState}
      selectedEntities={() =>
        selectedRowEntities().length > 0
          ? selectedRowEntities()
          : [row().entity]
      }
      viewContext={actionContext()}
      viewedProjectId={state.projectId()}
      onOpenChange={(open) => {
        if (!open) return;
        const current = row();
        setFocusedId(current.id);
        setInspectedEntity(current.entity);
      }}
    >
      <DriveListRowItem
        row={row()}
        depth={0}
        expandedIds={expandedFolderIds()}
        onToggleExpand={toggleExpandFolder}
        showLocationColumn={showLocationColumn()}
        isRecent={display.isRecentTab()}
        sort={state.value().sort}
        focused={focusedId() === row().id}
        selected={selectedIds().has(row().id)}
        selectedEntities={selectedRowEntities}
        onClearSelection={clearSelection}
        onFocus={(entity) => {
          setFocusedId(entity.id);
          setInspectedEntity(entity);
        }}
        onToggleSelect={toggleSelect}
        onActivate={activateEntity}
        createDropTarget={createDropTarget}
        splitId={panel.handle.id}
      />
    </SoupEntityContextMenu>
  );

  const ariaSortFor = (column: 'name' | 'updated_at') => {
    if (state.value().sort !== column) return 'none' as const;
    return preferences.sortDirection() === 'asc'
      ? ('ascending' as const)
      : ('descending' as const);
  };

  return (
    <EntityDragSelectionContext.Provider value={dragSelection}>
      <div
        ref={setGridRef}
        role="grid"
        aria-label="Drive files"
        aria-multiselectable="true"
        tabIndex={0}
        class="@container/drive-list relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
        onKeyDown={handleKeyDown}
      >
        {/* Structured Column Header */}
        <Show when={rows().length > 0 || isCreatingInlineHere()}>
          <div
            role="row"
            class="flex h-9 shrink-0 items-center gap-2 border-b border-edge-muted bg-panel/70 px-3 text-xs font-medium text-ink-muted select-none"
          >
            <div class="flex size-5 shrink-0 items-center justify-center">
              <MultiSelectCheckbox
                checked={allSelected()}
                onChecked={(checked) => {
                  if (checked) {
                    setSelectedIds(new Set(rows().map((row) => row.id)));
                  } else {
                    clearSelection();
                  }
                }}
              />
            </div>
            <div class="size-5 shrink-0" aria-hidden="true" />
            <div
              role="columnheader"
              aria-sort={ariaSortFor('name')}
              class="flex min-w-0 flex-1 items-center"
            >
              <Tooltip
                label={
                  state.value().sort === 'name'
                    ? t('drive.reverseSortOrder')
                    : t('drive.sortByColumn', {
                        column: t('drive.columnName'),
                      })
                }
              >
                <button
                  type="button"
                  data-drive-sort-header="name"
                  class={cn(
                    'group/sort -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
                    state.value().sort === 'name'
                      ? 'font-semibold text-ink'
                      : 'text-ink-muted'
                  )}
                  onClick={() => handleSortHeaderClick('name')}
                >
                  <span>{t('drive.columnName')}</span>
                  <Show
                    when={state.value().sort === 'name'}
                    fallback={
                      <CaretUpDownIcon
                        class="size-3 text-ink-subtle opacity-60 transition-opacity group-hover/sort:opacity-100"
                        aria-hidden="true"
                      />
                    }
                  >
                    <ArrowDownIcon
                      class={cn(
                        'size-3 text-ink transition-transform',
                        preferences.sortDirection() === 'asc' && 'rotate-180'
                      )}
                      aria-hidden="true"
                    />
                  </Show>
                </button>
              </Tooltip>
            </div>
            <Show when={showLocationColumn()}>
              <div
                role="columnheader"
                class="hidden w-36 shrink-0 px-2 @min-[760px]/drive-list:block"
              >
                {t('drive.columnLocation')}
              </div>
            </Show>
            <div
              role="columnheader"
              class="hidden w-24 shrink-0 @min-[640px]/drive-list:block"
            >
              {t('drive.columnKind')}
            </div>
            <div
              role="columnheader"
              class="hidden w-28 shrink-0 @min-[880px]/drive-list:block"
            >
              {t('drive.columnOwner')}
            </div>
            <div
              role="columnheader"
              aria-sort={ariaSortFor('updated_at')}
              class="hidden w-24 shrink-0 justify-end @min-[520px]/drive-list:flex"
            >
              <Tooltip
                label={
                  state.value().sort === 'updated_at'
                    ? t('drive.reverseSortOrder')
                    : t('drive.sortByColumn', {
                        column: t('drive.columnModified'),
                      })
                }
              >
                <button
                  type="button"
                  data-drive-sort-header="updated_at"
                  class={cn(
                    'group/sort -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
                    state.value().sort === 'updated_at'
                      ? 'font-semibold text-ink'
                      : 'text-ink-muted'
                  )}
                  onClick={() => handleSortHeaderClick('updated_at')}
                >
                  <span>{t('drive.columnModified')}</span>
                  <Show
                    when={state.value().sort === 'updated_at'}
                    fallback={
                      <CaretUpDownIcon
                        class="size-3 text-ink-subtle opacity-60 transition-opacity group-hover/sort:opacity-100"
                        aria-hidden="true"
                      />
                    }
                  >
                    <ArrowDownIcon
                      class={cn(
                        'size-3 text-ink transition-transform',
                        preferences.sortDirection() === 'asc' && 'rotate-180'
                      )}
                      aria-hidden="true"
                    />
                  </Show>
                </button>
              </Tooltip>
            </div>
            <div class="w-20 shrink-0" aria-hidden="true" />
          </div>
        </Show>

        <Switch>
          <Match when={source.isLoading() && rows().length === 0}>
            <DriveContentSkeleton mode="list" />
          </Match>
          <Match when={rows().length === 0 && !isCreatingInlineHere()}>
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
                    'drive-list-retry'
                  )
                }
              />
              <Show when={source.hasMore() && !source.isLoadingMore()}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    fireAndForget(source.loadMore(), 'drive-list-empty-more')
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
              class="min-h-0 flex-1 overflow-y-auto overscroll-none"
              onScroll={checkNearEnd}
            >
              {/* Inline new folder creation row */}
              <Show when={isCreatingInlineHere()}>
                <div class="flex h-11 items-center gap-2 border-b border-accent/30 bg-accent/5 px-3">
                  <div class="size-5 shrink-0" aria-hidden="true" />
                  <div class="size-5 shrink-0" aria-hidden="true" />
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
                    class="max-w-sm"
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
                  <span class="hidden text-xs text-ink-subtle sm:inline">
                    {t('drive.inlineRenameHint')}
                  </span>
                </div>
              </Show>

              <Switch
                fallback={
                  <Key each={rows()} by="id">
                    {(row) => renderRowWithContext(row)}
                  </Key>
                }
              >
                <Match when={display.isRecentTab()}>
                  <For each={recentGroups()}>
                    {(group) => (
                      <section aria-label={timeBucketLabel(group.bucket)}>
                        <div class="sticky top-0 z-1 border-b border-edge-muted bg-panel/95 px-4 py-1.5 text-xs font-semibold text-ink-muted backdrop-blur-xs">
                          {timeBucketLabel(group.bucket)}
                        </div>
                        <Key each={group.items} by="id">
                          {(row) => renderRowWithContext(row)}
                        </Key>
                      </section>
                    )}
                  </For>
                </Match>
                <Match
                  when={
                    display.isSharedTab() &&
                    display.shareScope() === 'all' &&
                    display.sharedGroups().hasResolvedProvenance
                  }
                >
                  <For each={display.sharedGroups().groups}>
                    {(group) => {
                      const title = () =>
                        group.bucket === 'direct'
                          ? t('drive.sharedSectionDirectTitle')
                          : t('drive.sharedSectionTeamOrChannelTitle');
                      const hint = () =>
                        group.bucket === 'direct'
                          ? t('drive.sharedSectionDirectHint')
                          : t('drive.sharedSectionTeamOrChannelHint');
                      return (
                        <section
                          aria-label={title()}
                          data-drive-shared-section={group.bucket}
                        >
                          <div class="sticky top-0 z-1 flex items-center gap-2 border-b border-edge-muted bg-panel/95 px-4 py-1.5 text-xs backdrop-blur-xs">
                            <span class="font-semibold text-ink">
                              {title()}
                            </span>
                            <span class="rounded-full bg-inset px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-muted">
                              {group.items.length}
                            </span>
                            <span class="hidden text-ink-subtle sm:inline">
                              · {hint()}
                            </span>
                          </div>
                          <Key each={group.items} by="id">
                            {(row) => renderRowWithContext(row)}
                          </Key>
                        </section>
                      );
                    }}
                  </For>
                </Match>
              </Switch>

              <Show when={source.isLoadingMore()}>
                <div
                  role="status"
                  class="flex items-center justify-center gap-2 py-4 text-xs text-ink-muted"
                >
                  <SpinnerIcon
                    class="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  <span>{t('drive.loadingMore')}</span>
                </div>
              </Show>
              <Show when={source.hasMore() && !source.isLoadingMore()}>
                <div class="flex justify-center py-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      fireAndForget(source.loadMore(), 'drive-list-load-more')
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
              'drive-bulk-star'
            )
          }
          onShare={() => host.shareEntities(selectedRowEntities())}
          onDuplicate={() =>
            fireAndForget(
              host.duplicateEntities(selectedRowEntities()),
              'drive-bulk-duplicate'
            )
          }
          onTrash={() => {
            const targets = selectedRowEntities();
            clearSelection();
            fireAndForget(
              host.trashEntitiesWithUndo(targets),
              'drive-bulk-trash'
            );
          }}
        />
      </div>
    </EntityDragSelectionContext.Provider>
  );
}
