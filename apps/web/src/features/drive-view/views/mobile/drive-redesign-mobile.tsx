import {
  CollectionPanes,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { t } from '@app/lib/i18n';
import { SplitRouter } from '@app/lib/split-router';
import { useFavoriteDisplayName } from '@app/util/favorites';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { SplitPanel } from '@components/app/split-panel';
import { EntityIcon } from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import { triggerFocusNewElement } from '@core/directive/focusInput';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type EntityData,
  EntityRowIcon,
  formatRelativeTimestamp,
} from '@entity';
import StarFillIcon from '@icon/system/fill/star-fill.svg';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import FilePlusIcon from '@icon/system/regular/file-plus.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import ListIcon from '@icon/system/regular/list.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
} from '@queries/auth/account-scope';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Key } from '@solid-primitives/keyed';
import { Button, cn, confirmDialog, Tabs } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  mapArray,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import {
  DriveContentSkeleton,
  DriveRedesignEmptyState,
} from '../../components/redesign/drive-empty-state';
import { InlineNameInput } from '../../components/redesign/inline-name-input';
import {
  driveKindExtensionBadge,
  driveKindLabel,
} from '../../components/redesign/kind-label';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import {
  driveItemKind,
  groupByTimeBucket,
  partitionFoldersAndFiles,
} from '../../core/drive-items';
import {
  type DriveTrashItem,
  filterTrashItems,
  summarizeTrashHierarchy,
} from '../../core/drive-trash';
import type { DriveRootBrowseMode } from '../../core/drive-view-mode';
import { folderAncestors } from '../../core/folder-tree';
import { useOptionalDriveDetailNavigation } from '../../drive-detail-navigation';
import {
  type DriveDisplayRow,
  useDriveDisplayItems,
} from '../shared/use-drive-display-items';
import { DriveRedesignMobileFilterDrawer } from './drive-redesign-mobile-filter-drawer';
import { DriveMobileFilterStrip } from './drive-redesign-mobile-filter-strip';
import { DriveRedesignMobileItemSheet } from './drive-redesign-mobile-item-sheet';
import { DriveRedesignMobileSidebar } from './drive-redesign-mobile-sidebar';

function mobileEntityTimestamp(entity: EntityData) {
  const raw =
    entity.type === 'database' || entity.type === 'form'
      ? entity.createdAt
      : 'touchedAt' in entity && entity.touchedAt
        ? entity.touchedAt
        : entity.updatedAt;
  if (raw == null) return undefined;
  return typeof raw === 'number' ? new Date(raw) : raw;
}

function mobileTrashIconTarget(item: DriveTrashItem): string {
  if (item.itemType === 'project') return 'project';
  if (item.itemType === 'chat') return 'chat';
  return item.fileType || 'md';
}

function MobileStarredRow(props: {
  favorite: Favorite;
  name: Accessor<string>;
}) {
  const { actions } = useDriveView();
  const { host } = useDriveRedesign();
  const kind = () =>
    driveItemKind({
      type: props.favorite.entityType,
      fileType: props.favorite.fileType ?? undefined,
      subType: props.favorite.documentSubType
        ? { type: props.favorite.documentSubType }
        : undefined,
    });

  return (
    <div
      data-press-surface
      class="flex min-h-13 min-w-0 items-center gap-3 border-b border-edge-muted/60 px-4 py-2"
      onClick={(event) =>
        actions.openFavorite(props.favorite, props.name(), event)
      }
    >
      <FavoriteIcon favorite={props.favorite} class="size-6 shrink-0" />
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-sm font-medium text-ink">
          {props.name()}
        </span>
        <span class="text-xs text-ink-muted">{driveKindLabel(kind())}</span>
      </div>
      <Button
        variant="ghost"
        size="icon-md"
        aria-label={t('drive.unstar')}
        onClick={(event) => {
          event.stopPropagation();
          fireAndForget(
            host.unstarFavorite(props.favorite),
            'drive-mobile-unstar'
          );
        }}
      >
        <StarFillIcon class="size-4 text-warning" aria-hidden="true" />
      </Button>
    </div>
  );
}

function MobileTrashView() {
  const { state, sidebar } = useDriveView();
  const { trash } = useDriveRedesign();
  const [busy, setBusy] = createSignal(false);

  const foldersById = createMemo(() => {
    const map = new Map<string, string>();
    for (const folder of sidebar.folders()) map.set(folder.id, folder.name);
    return map;
  });

  const filtered = createMemo(() =>
    filterTrashItems(trash.items(), state.value().search)
  );
  const hierarchy = createMemo(() => summarizeTrashHierarchy(filtered()));
  const visibleItems = () => hierarchy().topLevel;

  const restoreItem = async (item: DriveTrashItem) => {
    if (busy()) return;
    const captured = currentQueryAccount();
    setBusy(true);
    try {
      const { restored, failed } = await trash.restoreItems(
        [{ id: item.id, itemType: item.itemType }],
        captured
      );
      if (captured && !isCurrentQueryAccount(captured)) return;
      if (restored > 0) toast.success(t('drive.toastRestored', { count: 1 }));
      if (failed > 0) toast.failure(t('drive.toastRestoreFailed'));
    } finally {
      setBusy(false);
    }
  };

  const deleteForever = async (item: DriveTrashItem) => {
    if (busy()) return;
    const captured = currentQueryAccount();
    const confirmed = await confirmDialog({
      title: t('drive.deleteForeverConfirmTitle', { count: 1 }),
      body: t('drive.deleteForeverConfirmDescription'),
      confirmLabel: t('drive.deleteForever'),
      tone: 'danger',
    });
    if (!confirmed || (captured && !isCurrentQueryAccount(captured))) return;
    setBusy(true);
    try {
      const { deleted, failed } = await trash.permanentlyDeleteItems(
        [{ id: item.id, itemType: item.itemType }],
        captured
      );
      if (captured && !isCurrentQueryAccount(captured)) return;
      if (deleted > 0) {
        toast.success(t('drive.toastDeletedForever', { count: deleted }));
      }
      if (failed > 0) toast.failure(t('drive.toastDeleteForeverFailed'));
    } finally {
      setBusy(false);
    }
  };

  const unfilteredHierarchy = createMemo(() =>
    summarizeTrashHierarchy(trash.items())
  );
  const isSearching = () => state.value().search.trim().length > 0;

  const emptyTrash = async () => {
    const all = unfilteredHierarchy().topLevel;
    if (all.length === 0 || busy() || isSearching()) return;
    const captured = currentQueryAccount();
    const hasMore = trash.hasMore();
    const hasFolders = all.some((item) => item.itemType === 'project');
    const baseBody = hasMore
      ? t('drive.emptyTrashLoadedConfirmDescription', { count: all.length })
      : t('drive.emptyTrashConfirmDescription', { count: all.length });
    const body = hasFolders
      ? `${baseBody} ${t('drive.trashFolderCascadeWarning')}`
      : baseBody;
    const confirmed = await confirmDialog({
      title: hasMore
        ? t('drive.emptyTrashLoadedConfirmTitle')
        : t('drive.emptyTrashConfirmTitle'),
      body,
      confirmLabel: hasMore
        ? t('drive.emptyTrashLoadedLabel')
        : t('drive.emptyTrash'),
      tone: 'danger',
    });
    if (!confirmed || (captured && !isCurrentQueryAccount(captured))) return;
    setBusy(true);
    try {
      const { deleted, failed } = await trash.permanentlyDeleteItems(
        all.map((item) => ({ id: item.id, itemType: item.itemType })),
        captured
      );
      if (captured && !isCurrentQueryAccount(captured)) return;
      if (deleted > 0) {
        toast.success(t('drive.toastDeletedForever', { count: deleted }));
      }
      if (failed > 0) toast.failure(t('drive.toastDeleteForeverFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Switch>
      <Match when={trash.error() && trash.items().length === 0}>
        <DriveRedesignEmptyState
          reason="error"
          onRetry={() =>
            fireAndForget(trash.refresh(), 'drive-mobile-trash-retry')
          }
        />
      </Match>
      <Match when={trash.isLoading() && trash.items().length === 0}>
        <div class="pt-(--mobile-content-inset-top)">
          <DriveContentSkeleton mode="list" label={t('drive.loadingTrash')} />
        </div>
      </Match>
      <Match when={visibleItems().length === 0}>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          <DriveRedesignEmptyState
            reason={isSearching() ? 'search' : 'trash'}
            onClearSearch={() => state.setSearch('')}
          />
          <Show when={isSearching() && trash.hasMore()}>
            <Button
              variant="secondary"
              size="sm"
              disabled={trash.isLoadingMore()}
              onClick={() =>
                fireAndForget(
                  trash.loadMore(),
                  'drive-mobile-trash-search-more'
                )
              }
            >
              {trash.isLoadingMore()
                ? t('drive.loadingMore')
                : t('drive.loadMoreTrashMatches')}
            </Button>
          </Show>
        </div>
      </Match>
      <Match when={true}>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-none pt-(--mobile-content-inset-top) pb-[calc(var(--safe-bottom,0px)+5rem)]">
          <div class="flex items-center justify-between gap-2 border-b border-edge-muted px-4 py-2.5 text-xs text-ink-muted">
            <span>
              {t('drive.itemCount', { count: visibleItems().length })}
            </span>
            <Show when={!isSearching()}>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy()}
                class="text-failure-ink"
                onClick={() =>
                  fireAndForget(emptyTrash(), 'drive-mobile-empty')
                }
              >
                <TrashIcon class="size-4" aria-hidden="true" />
                <span>
                  {trash.hasMore()
                    ? t('drive.emptyTrashLoadedLabel')
                    : t('drive.emptyTrash')}
                </span>
              </Button>
            </Show>
          </div>
          <For each={visibleItems()}>
            {(item) => {
              const parentName = () =>
                item.parentFolderId
                  ? foldersById().get(item.parentFolderId)
                  : undefined;
              return (
                <div class="flex min-h-14 min-w-0 items-center gap-3 border-b border-edge-muted/60 px-4 py-2">
                  <span class="flex size-6 shrink-0 items-center justify-center opacity-75">
                    <EntityIcon
                      targetType={mobileTrashIconTarget(item)}
                      size="fill"
                    />
                  </span>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-sm font-medium text-ink">
                      {item.name}
                    </span>
                    <span class="truncate text-xs text-ink-muted">
                      {parentName() ?? t('drive.unfiledLocation')}
                      {item.deletedAt
                        ? ` · ${formatRelativeTimestamp(item.deletedAt)}`
                        : ''}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy()}
                    onClick={() =>
                      fireAndForget(restoreItem(item), 'drive-mobile-restore')
                    }
                  >
                    <ArrowCounterClockwiseIcon
                      class="size-3.5"
                      aria-hidden="true"
                    />
                    <span>{t('drive.restore')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-md"
                    disabled={busy()}
                    aria-label={t('drive.deleteForever')}
                    class="text-failure-ink"
                    onClick={() =>
                      fireAndForget(
                        deleteForever(item),
                        'drive-mobile-delete-forever'
                      )
                    }
                  >
                    <TrashIcon class="size-4" aria-hidden="true" />
                  </Button>
                </div>
              );
            }}
          </For>
          <Show when={trash.isLoadingMore()}>
            <div
              role="status"
              class="flex items-center justify-center gap-2 py-4 text-xs text-ink-muted"
            >
              <SpinnerIcon class="size-3.5 animate-spin" aria-hidden="true" />
              <span>{t('drive.loadingMore')}</span>
            </div>
          </Show>
          <Show when={trash.hasMore() && !trash.isLoadingMore()}>
            <div class="flex justify-center py-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  fireAndForget(
                    trash.loadMore(),
                    'drive-mobile-trash-load-more'
                  )
                }
              >
                {t('drive.loadMore')}
              </Button>
            </div>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

function MobileStarredView() {
  const { state, sidebar } = useDriveView();

  const resolvedFavorites = createMemo(
    mapArray(sidebar.favorites, (favorite) => ({
      favorite,
      name: useFavoriteDisplayName(favorite),
    }))
  );

  const filtered = createMemo(() => {
    const term = state.value().search.trim().toLocaleLowerCase();
    const list = resolvedFavorites();
    if (!term) return list;
    return list.filter(({ name }) => name().toLocaleLowerCase().includes(term));
  });

  return (
    <Show
      when={filtered().length > 0}
      fallback={
        <DriveRedesignEmptyState
          reason={state.value().search.trim() ? 'search' : 'starred'}
          onClearSearch={() => state.setSearch('')}
          onBackToDrive={() => state.selectTab('owned')}
        />
      }
    >
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-none pt-(--mobile-content-inset-top) pb-[calc(var(--safe-bottom,0px)+5rem)]">
        <For each={filtered()}>
          {(entry) => (
            <MobileStarredRow favorite={entry.favorite} name={entry.name} />
          )}
        </For>
      </div>
    </Show>
  );
}

function MobileDriveListRow(props: {
  row: DriveDisplayRow;
  onActivate: (entity: EntityData, event: MouseEvent) => void;
  onOpenSheet: (entity: EntityData) => void;
}) {
  const { actions } = useDriveView();
  const { host } = useDriveRedesign();
  const kind = () => driveItemKind(props.row.entity);
  const starred = () => host.isStarred(props.row.entity);
  const ts = () => mobileEntityTimestamp(props.row.entity);
  const isShared = () => {
    const ownerId =
      'ownerId' in props.row.entity ? props.row.entity.ownerId : undefined;
    const viewerId = actions.userId();
    return Boolean(ownerId && viewerId && ownerId !== viewerId);
  };

  return (
    <div
      data-press-surface
      data-drive-mobile-row={props.row.id}
      class="flex min-h-14 min-w-0 items-center gap-2 border-b border-edge-muted/60 px-4 py-2 select-none"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-accent"
        onClick={(event) => props.onActivate(props.row.entity, event)}
      >
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset/70">
          <EntityRowIcon entity={props.row.entity} class="size-5" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="min-w-0 truncate text-sm font-medium text-ink">
              {props.row.entity.name || t('drive.folderNamePlaceholder')}
            </span>
            <Show when={starred()}>
              <StarFillIcon
                class="size-3.5 shrink-0 text-warning"
                aria-label={t('drive.starred')}
              />
            </Show>
          </div>
          <div class="flex min-w-0 items-center gap-1.5 truncate text-xs text-ink-muted">
            <Show
              when={props.row.isFolder && props.row.subfolderCount > 0}
              fallback={<span>{driveKindLabel(kind())}</span>}
            >
              <span>
                {t('drive.subfolderCount', { count: props.row.subfolderCount })}
              </span>
            </Show>
            <Show when={isShared()}>
              <span>· {t('drive.sharedLabel')}</span>
            </Show>
            <Show when={ts()}>
              {(date) => <span>· {formatRelativeTimestamp(date())}</span>}
            </Show>
          </div>
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon-md"
        aria-label={`${t('drive.moreActions')} for ${props.row.entity.name}`}
        class="shrink-0 text-ink-muted"
        onClick={(event) => {
          event.stopPropagation();
          props.onOpenSheet(props.row.entity);
        }}
      >
        <DotsIcon class="size-5" aria-hidden="true" />
      </Button>
    </div>
  );
}

function MobileDriveGridCard(props: {
  row: DriveDisplayRow;
  onActivate: (entity: EntityData, event: MouseEvent) => void;
  onOpenSheet: (entity: EntityData) => void;
}) {
  const { host } = useDriveRedesign();
  const kind = () => driveItemKind(props.row.entity);
  const starred = () => host.isStarred(props.row.entity);
  const fileType = () =>
    'fileType' in props.row.entity ? props.row.entity.fileType : undefined;

  return (
    <Show
      when={!props.row.isFolder}
      fallback={
        <div
          data-press-surface
          data-drive-mobile-card={props.row.id}
          role="button"
          tabIndex={0}
          class="flex min-h-14 min-w-0 items-center gap-2.5 rounded-xl border border-edge-muted bg-panel px-3 py-2 select-none"
          onClick={(event) => props.onActivate(props.row.entity, event)}
        >
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset">
            <EntityRowIcon entity={props.row.entity} class="size-5" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm font-medium text-ink">
              {props.row.entity.name || t('drive.folderNamePlaceholder')}
            </span>
            <span class="truncate text-[11px] text-ink-muted">
              {props.row.subfolderCount > 0
                ? t('drive.subfolderCount', { count: props.row.subfolderCount })
                : t('drive.kindFolder')}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${t('drive.moreActions')} for ${props.row.entity.name}`}
            class="shrink-0 text-ink-muted"
            onClick={(event) => {
              event.stopPropagation();
              props.onOpenSheet(props.row.entity);
            }}
          >
            <DotsIcon class="size-4" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      <div
        data-press-surface
        data-drive-mobile-card={props.row.id}
        role="button"
        tabIndex={0}
        class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel select-none"
        onClick={(event) => props.onActivate(props.row.entity, event)}
      >
        <div class="relative flex h-24 w-full items-center justify-center border-b border-edge-muted/70 bg-inset/60">
          <div class="flex size-12 items-center justify-center rounded-xl border border-edge-muted bg-surface shadow-xs">
            <span class="size-6">
              <EntityRowIcon entity={props.row.entity} />
            </span>
          </div>
          <span class="absolute right-2 bottom-1.5 rounded border border-edge-muted bg-surface/90 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
            {driveKindExtensionBadge(kind(), fileType())}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${t('drive.moreActions')} for ${props.row.entity.name}`}
            class="absolute top-1 right-1 bg-surface/85 text-ink-muted"
            onClick={(event) => {
              event.stopPropagation();
              props.onOpenSheet(props.row.entity);
            }}
          >
            <DotsIcon class="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div class="flex min-w-0 flex-col gap-1 p-2.5">
          <div class="flex items-start gap-1">
            <span class="line-clamp-2 min-h-[2.25rem] flex-1 text-xs leading-snug font-medium text-ink">
              {props.row.entity.name}
            </span>
            <Show when={starred()}>
              <StarFillIcon
                class="mt-0.5 size-3 shrink-0 text-warning"
                aria-hidden="true"
              />
            </Show>
          </div>
          <span class="truncate text-[11px] text-ink-muted">
            {driveKindLabel(kind())}
          </span>
        </div>
      </div>
    </Show>
  );
}

function MobileLoading() {
  return (
    <div class="grid size-full place-items-center pt-(--mobile-content-inset-top) text-ink-muted">
      <SpinnerIcon
        aria-hidden={false}
        aria-label="Loading files"
        class="size-5 animate-spin"
      />
    </div>
  );
}

/**
 * Dedicated touch/mobile redesigned Drive workspace (FE-70).
 * Pairs a floating header with location title, expandable folder-scoped
 * search, List/Grid toggle, universal Sort & Filter drawer, scrollable
 * touch breadcrumbs, Browse/All files pills, 44px+ rows/cards, bottom item
 * action sheets with inline rename, Trash & Starred views, and a quick-create
 * sheet.
 */
export function DriveRedesignMobileWorkspace(props: { tour?: JSX.Element }) {
  const { state, source, sidebar, actions } = useDriveView();
  const { preferences, inlineEdit, host } = useDriveRedesign();
  const display = useDriveDisplayItems();
  const navigation = useOptionalDriveDetailNavigation();

  const [searchOpen, setSearchOpen] = createSignal(false);
  const [sheetEntity, setSheetEntity] = createSignal<EntityData | undefined>();
  const [createSheetOpen, setCreateSheetOpen] = createSignal(false);

  const location = () => state.value().location;
  const isTrash = () => {
    const loc = location();
    return loc.kind === 'tab' && loc.tab === 'trash';
  };
  const isStarred = () => {
    const loc = location();
    return loc.kind === 'tab' && loc.tab === 'starred';
  };
  const activeFolderId = () => state.projectId();

  const ancestors = createMemo(() => {
    const id = activeFolderId();
    if (!id) return [];
    return folderAncestors(sidebar.folders(), id);
  });

  const activeFolder = createMemo(() => {
    const id = activeFolderId();
    if (!id) return undefined;
    return sidebar.folders().find((f) => f.id === id);
  });

  const parentFolder = createMemo(() => {
    const chain = ancestors();
    return chain.length > 1 ? chain[chain.length - 2] : undefined;
  });

  const currentTitle = () => {
    const folder = activeFolder();
    if (folder) return folder.name;
    const loc = location();
    if (loc.kind === 'folder') return t('drive.myDrive');
    switch (loc.tab) {
      case 'recent':
        return t('drive.recent');
      case 'shared':
        return t('drive.sharedWithMe');
      case 'starred':
        return t('drive.starred');
      case 'trash':
        return t('drive.trash');
      default:
        return t('drive.myDrive');
    }
  };

  const isGridMode = () => preferences.viewMode() === 'grid';

  const isCreatingInlineHere = () => {
    const target = inlineEdit.creatingFolder();
    return target?.surface === 'list' || target?.surface === 'grid';
  };

  const splitBands = createMemo(() => {
    const items = display.items();
    if (!preferences.foldersFirst()) {
      return { folders: [] as DriveDisplayRow[], files: items };
    }
    const { folders, files } = partitionFoldersAndFiles(
      items.map((row) => ({ ...row, type: row.entity.type }))
    );
    return { folders, files };
  });

  const recentGroups = createMemo(() => {
    if (!display.isRecentTab()) return [];
    return groupByTimeBucket(display.items(), (row) =>
      mobileEntityTimestamp(row.entity)
    );
  });

  const emptyReason = () => {
    if (source.error() && !source.hasData()) return 'error' as const;
    if (display.isSearching()) return 'search' as const;
    if (display.hasFilters()) return 'filters' as const;
    if (activeFolderId()) return 'folder' as const;
    if (display.isSharedTab()) return 'shared' as const;
    if (display.isRecentTab()) return 'recent' as const;
    return 'my-drive' as const;
  };

  const startInlineFolder = () => {
    inlineEdit.startCreateFolder({
      parentId: activeFolderId() ?? null,
      surface: isGridMode() ? 'grid' : 'list',
    });
  };

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          contentLayout="collection"
          asidePreferenceKey="documents"
          aside={{ preserveDuringResize: false }}
          main={{ preferredWidth: 640 }}
        >
          <ViewShell.Aside>
            <DriveRedesignMobileSidebar />
          </ViewShell.Aside>

          <CollectionPanes
            hasDetail={Boolean(
              navigation?.active() || navigation?.activeCallId()
            )}
            list={
              <MobileListLayout
                header={
                  <div class="flex min-w-0 flex-col gap-2">
                    {/* Primary floating control bar */}
                    <Show
                      when={searchOpen() || display.isSearching()}
                      fallback={
                        <div class="flex min-h-11 min-w-0 items-center gap-2">
                          <ViewSidebar.Toggle
                            action="expand"
                            presentation="pill"
                          />

                          <div class="island flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-chrome px-3.5">
                            <Show when={activeFolderId()}>
                              <button
                                type="button"
                                aria-label={t('drive.goToParentFolder')}
                                class="inline-flex size-7 -ml-1.5 shrink-0 items-center justify-center rounded-full text-ink-muted"
                                onClick={() => {
                                  const parent = parentFolder();
                                  if (parent) state.selectFolder(parent.id);
                                  else state.selectTab('owned');
                                }}
                              >
                                <ArrowUpIcon
                                  class="size-4"
                                  aria-hidden="true"
                                />
                              </button>
                            </Show>
                            <h1 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                              {currentTitle()}
                            </h1>
                          </div>

                          <Button
                            variant="ghost"
                            size="icon-md"
                            aria-label={t('drive.searchDrivePlaceholder')}
                            class="island h-10 w-10 shrink-0 rounded-full bg-chrome"
                            onClick={() => {
                              // Register watcher BEFORE mounting the search input so Solid's
                              // synchronous render effect doesn't beat the observer on iOS.
                              triggerFocusNewElement(
                                '[data-drive-mobile-search-input]',
                                { touchOnly: false }
                              );
                              setSearchOpen(true);
                            }}
                          >
                            <SearchIcon class="size-5" aria-hidden="true" />
                          </Button>

                          <Show when={!isTrash()}>
                            <Button
                              variant="ghost"
                              size="icon-md"
                              aria-label={
                                isGridMode()
                                  ? t('drive.viewList')
                                  : t('drive.viewGrid')
                              }
                              class="island h-10 w-10 shrink-0 rounded-full bg-chrome"
                              onClick={() =>
                                preferences.setViewMode(
                                  isGridMode() ? 'list' : 'grid'
                                )
                              }
                            >
                              <Show
                                when={isGridMode()}
                                fallback={
                                  <SquaresFourIcon
                                    class="size-5"
                                    aria-hidden="true"
                                  />
                                }
                              >
                                <ListIcon class="size-5" aria-hidden="true" />
                              </Show>
                            </Button>
                          </Show>

                          <Show when={!isTrash() && !isStarred()}>
                            <DriveRedesignMobileFilterDrawer />
                          </Show>
                        </div>
                      }
                    >
                      {/* Expanded inline search pill */}
                      <div class="island flex h-11 min-w-0 items-center gap-2 rounded-full bg-chrome px-3">
                        <SearchIcon
                          class="size-4 shrink-0 text-ink-muted"
                          aria-hidden="true"
                        />
                        <input
                          type="search"
                          data-drive-mobile-search-input
                          aria-label={t('drive.searchDrivePlaceholder')}
                          placeholder={
                            activeFolder()
                              ? t('drive.searchFolderPlaceholder', {
                                  name: activeFolder()!.name,
                                })
                              : t('drive.searchDrivePlaceholder')
                          }
                          value={state.value().search}
                          class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
                          onInput={(event) =>
                            state.setSearch(event.currentTarget.value)
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('drive.clearSearch')}
                          onClick={() => {
                            state.setSearch('');
                            setSearchOpen(false);
                          }}
                        >
                          <CloseIcon class="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </Show>

                    {/* Scrollable touch breadcrumbs inside folders */}
                    <Show when={ancestors().length > 0}>
                      <nav
                        aria-label={t('drive.folders')}
                        class="flex items-center gap-1 overflow-x-auto pb-0.5 text-xs [scrollbar-width:none]"
                      >
                        <button
                          type="button"
                          class="island inline-flex h-8 shrink-0 items-center rounded-full bg-chrome/90 px-2.5 font-medium text-ink-muted"
                          onClick={() => state.selectTab('owned')}
                        >
                          {t('drive.myDrive')}
                        </button>
                        <For each={ancestors()}>
                          {(folder, index) => {
                            const isLast = () =>
                              index() === ancestors().length - 1;
                            return (
                              <>
                                <CaretRightIcon
                                  class="size-3 shrink-0 text-ink-subtle"
                                  aria-hidden="true"
                                />
                                <button
                                  type="button"
                                  aria-current={isLast() ? 'page' : undefined}
                                  class={cn(
                                    'island inline-flex h-8 max-w-44 shrink-0 items-center rounded-full bg-chrome/90 px-2.5',
                                    isLast()
                                      ? 'font-semibold text-ink'
                                      : 'font-medium text-ink-muted'
                                  )}
                                  onClick={() => state.selectFolder(folder.id)}
                                >
                                  <span class="truncate">{folder.name}</span>
                                </button>
                              </>
                            );
                          }}
                        </For>
                      </nav>
                    </Show>

                    {/* Compact horizontally-scrollable Ask AI + filter pills */}
                    <Show when={!isTrash() && !isStarred()}>
                      <DriveMobileFilterStrip />
                    </Show>

                    {/* My Drive Browse / All files segmented pill + New button (also inside folders) */}
                    <Show
                      when={
                        (!isTrash() &&
                          !isStarred() &&
                          Boolean(activeFolderId())) ||
                        (display.isMyDriveRoot() &&
                          !display.isSearching() &&
                          !display.hasFilters())
                      }
                    >
                      <div class="flex items-center gap-2">
                        <Show
                          when={
                            display.isMyDriveRoot() &&
                            !display.isSearching() &&
                            !display.hasFilters()
                          }
                        >
                          <Tabs
                            touch="pill"
                            size="sm"
                            aria-label={t('drive.rootModeLabel')}
                            value={preferences.rootMode()}
                            onChange={(value) =>
                              preferences.setRootMode(
                                value as DriveRootBrowseMode
                              )
                            }
                            options={[
                              {
                                value: 'browse',
                                label: t('drive.browseMode'),
                              },
                              {
                                value: 'all',
                                label: t('drive.allFilesMode'),
                              },
                            ]}
                          />
                        </Show>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="island ml-auto h-9 rounded-full bg-chrome px-3 text-xs font-medium text-ink"
                          onClick={() => setCreateSheetOpen(true)}
                        >
                          <PlusIcon class="size-4" aria-hidden="true" />
                          <span>New</span>
                        </Button>
                      </div>
                    </Show>

                    {/* Folder-scoped search escape hatch */}
                    <Show
                      when={display.isSearching() ? activeFolder() : undefined}
                    >
                      {(folder) => (
                        <div class="island flex items-center justify-between gap-2 rounded-2xl bg-chrome px-3 py-1.5 text-xs text-ink-muted">
                          <span class="truncate">
                            {t('drive.searchingInFolder', {
                              name: folder().name,
                            })}
                          </span>
                          <Button
                            variant="ghost"
                            size="xs"
                            class="shrink-0 font-medium text-accent"
                            onClick={() => {
                              const query = state.value().search;
                              state.selectTab('owned');
                              state.setSearch(query);
                            }}
                          >
                            {t('drive.searchAllDrive')}
                          </Button>
                        </div>
                      )}
                    </Show>
                  </div>
                }
              >
                {props.tour}
                <ViewShell.Content>
                  <Suspense fallback={<MobileLoading />}>
                    <Switch>
                      <Match when={isTrash()}>
                        <MobileTrashView />
                      </Match>
                      <Match when={isStarred()}>
                        <MobileStarredView />
                      </Match>
                      <Match
                        when={
                          source.isLoading() && display.items().length === 0
                        }
                      >
                        <div class="pt-(--mobile-content-inset-top)">
                          <DriveContentSkeleton
                            mode={isGridMode() ? 'grid' : 'list'}
                          />
                        </div>
                      </Match>
                      <Match
                        when={
                          display.items().length === 0 &&
                          !isCreatingInlineHere()
                        }
                      >
                        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
                          <DriveRedesignEmptyState
                            reason={emptyReason()}
                            isInFolder={Boolean(activeFolderId())}
                            onCreateDocument={() => host.createNewItem('md')}
                            onCreateFolder={startInlineFolder}
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
                                source.refresh(),
                                'drive-mobile-retry'
                              )
                            }
                          />
                          <Show
                            when={source.hasMore() && !source.isLoadingMore()}
                          >
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                fireAndForget(
                                  source.loadMore(),
                                  'drive-mobile-empty-load-more'
                                )
                              }
                            >
                              {t('drive.loadMore')}
                            </Button>
                          </Show>
                        </div>
                      </Match>
                      <Match when={isGridMode()}>
                        <div class="min-h-0 flex-1 overflow-y-auto overscroll-none px-3 pt-(--mobile-content-inset-top) pb-[calc(var(--safe-bottom,0px)+5rem)]">
                          <Show when={isCreatingInlineHere()}>
                            <div class="mb-3 flex min-h-12 items-center gap-2 rounded-xl border border-accent bg-accent/5 px-3">
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
                                      inlineEdit.creatingFolder()?.parentId ??
                                        null
                                    );
                                  })
                                }
                                onCancel={inlineEdit.cancelCreateFolder}
                              />
                            </div>
                          </Show>

                          <Show when={splitBands().folders.length > 0}>
                            <section class="mb-5">
                              <h2 class="mb-2 px-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                                {t('drive.folders')}
                              </h2>
                              <div class="grid grid-cols-2 gap-2.5">
                                <Key each={splitBands().folders} by="id">
                                  {(row) => (
                                    <MobileDriveGridCard
                                      row={row()}
                                      onActivate={(entity, event) =>
                                        actions.openEntity(entity, event)
                                      }
                                      onOpenSheet={setSheetEntity}
                                    />
                                  )}
                                </Key>
                              </div>
                            </section>
                          </Show>

                          <Show when={splitBands().files.length > 0}>
                            <section>
                              <Show when={splitBands().folders.length > 0}>
                                <h2 class="mb-2 px-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                                  {t('drive.filesSection')}
                                </h2>
                              </Show>
                              <div class="grid grid-cols-2 gap-2.5">
                                <Key each={splitBands().files} by="id">
                                  {(row) => (
                                    <MobileDriveGridCard
                                      row={row()}
                                      onActivate={(entity, event) =>
                                        actions.openEntity(entity, event)
                                      }
                                      onOpenSheet={setSheetEntity}
                                    />
                                  )}
                                </Key>
                              </div>
                            </section>
                          </Show>

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
                          <Show
                            when={source.hasMore() && !source.isLoadingMore()}
                          >
                            <div class="flex justify-center py-4">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  fireAndForget(
                                    source.loadMore(),
                                    'drive-mobile-grid-more'
                                  )
                                }
                              >
                                {t('drive.loadMore')}
                              </Button>
                            </div>
                          </Show>
                        </div>
                      </Match>
                      <Match when={true}>
                        <div class="min-h-0 flex-1 overflow-y-auto overscroll-none pt-(--mobile-content-inset-top) pb-[calc(var(--safe-bottom,0px)+5rem)]">
                          <Show when={isCreatingInlineHere()}>
                            <div class="flex min-h-13 items-center gap-2 border-b border-accent/30 bg-accent/5 px-4">
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
                                      inlineEdit.creatingFolder()?.parentId ??
                                        null
                                    );
                                  })
                                }
                                onCancel={inlineEdit.cancelCreateFolder}
                              />
                            </div>
                          </Show>

                          <Show
                            when={display.isRecentTab()}
                            fallback={
                              <Key each={display.items()} by="id">
                                {(row) => (
                                  <MobileDriveListRow
                                    row={row()}
                                    onActivate={(entity, event) =>
                                      actions.openEntity(entity, event)
                                    }
                                    onOpenSheet={setSheetEntity}
                                  />
                                )}
                              </Key>
                            }
                          >
                            <For each={recentGroups()}>
                              {(group) => (
                                <section>
                                  <div class="border-b border-edge-muted bg-panel/90 px-4 py-1.5 text-xs font-semibold text-ink-muted">
                                    {group.bucket === 'today'
                                      ? t('drive.bucketToday')
                                      : group.bucket === 'yesterday'
                                        ? t('drive.bucketYesterday')
                                        : group.bucket === 'this_week'
                                          ? t('drive.bucketThisWeek')
                                          : t('drive.bucketEarlier')}
                                  </div>
                                  <Key each={group.items} by="id">
                                    {(row) => (
                                      <MobileDriveListRow
                                        row={row()}
                                        onActivate={(entity, event) =>
                                          actions.openEntity(entity, event)
                                        }
                                        onOpenSheet={setSheetEntity}
                                      />
                                    )}
                                  </Key>
                                </section>
                              )}
                            </For>
                          </Show>

                          <Show when={source.hasMore()}>
                            <div class="flex justify-center py-4">
                              <Button
                                variant="secondary"
                                size="md"
                                onClick={() =>
                                  fireAndForget(
                                    source.loadMore(),
                                    'drive-mobile-more'
                                  )
                                }
                              >
                                {t('drive.loadMore')}
                              </Button>
                            </div>
                          </Show>
                        </div>
                      </Match>
                    </Switch>
                  </Suspense>
                </ViewShell.Content>

                <DriveRedesignMobileItemSheet
                  entity={sheetEntity()}
                  onClose={() => setSheetEntity(undefined)}
                />

                {/* Quick Create bottom sheet */}
                <MobileDrawer
                  side="bottom"
                  open={createSheetOpen()}
                  onOpenChange={setCreateSheetOpen}
                >
                  <MobileDrawer.Portal>
                    <MobileDrawer.Overlay />
                    <MobileDrawer.Content aria-label="New">
                      <MobileDrawer.Handle />
                      <MobileDrawer.ScrollBody class="gap-2 px-1">
                        <MobileDrawer.Label>Create</MobileDrawer.Label>
                        <MobileDrawer.Section>
                          <MobileDrawer.Item
                            onClick={() => {
                              setCreateSheetOpen(false);
                              startInlineFolder();
                            }}
                          >
                            <FolderPlusIcon
                              class="size-5 shrink-0 text-ink-muted"
                              aria-hidden="true"
                            />
                            <span>{t('drive.newFolderInline')}</span>
                          </MobileDrawer.Item>
                          <MobileDrawer.Item
                            onClick={() => {
                              setCreateSheetOpen(false);
                              host.createNewItem('md');
                            }}
                          >
                            <FilePlusIcon
                              class="size-5 shrink-0 text-ink-muted"
                              aria-hidden="true"
                            />
                            <span>{t('drive.createDocument')}</span>
                          </MobileDrawer.Item>
                          <MobileDrawer.Item
                            onClick={() => {
                              setCreateSheetOpen(false);
                              host.createNewItem('database');
                            }}
                          >
                            <span class="flex size-5 shrink-0 items-center justify-center">
                              <EntityIcon targetType="database" size="fill" />
                            </span>
                            <span>{t('drive.kindDatabase')}</span>
                          </MobileDrawer.Item>
                          <MobileDrawer.Item
                            onClick={() => {
                              setCreateSheetOpen(false);
                              actions.uploadFiles();
                            }}
                          >
                            <PlusIcon
                              class="size-5 shrink-0 text-ink-muted"
                              aria-hidden="true"
                            />
                            <span>{t('drive.uploadFiles')}</span>
                          </MobileDrawer.Item>
                        </MobileDrawer.Section>
                      </MobileDrawer.ScrollBody>
                    </MobileDrawer.Content>
                  </MobileDrawer.Portal>
                </MobileDrawer>
              </MobileListLayout>
            }
          >
            <Show when={navigation}>
              <Suspense fallback={<MobileLoading />}>
                <SplitRouter.Outlet />
              </Suspense>
            </Show>
          </CollectionPanes>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
