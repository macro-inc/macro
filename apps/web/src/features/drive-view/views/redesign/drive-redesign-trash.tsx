import { t } from '@app/lib/i18n';
import { EntityIcon } from '@core/component/EntityIcon';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { formatRelativeTimestamp, MultiSelectCheckbox } from '@entity';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { Button, cn, confirmDialog, Tooltip } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import {
  DriveContentSkeleton,
  DriveRedesignEmptyState,
} from '../../components/redesign/drive-empty-state';
import { driveKindLabel } from '../../components/redesign/kind-label';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import { driveItemKind } from '../../core/drive-items';
import {
  type DriveTrashItem,
  filterTrashItems,
  summarizeTrashHierarchy,
} from '../../core/drive-trash';

function trashIconTarget(item: DriveTrashItem): string {
  if (item.itemType === 'project') return 'project';
  if (item.itemType === 'chat') return 'chat';
  return item.fileType || 'md';
}

export function DriveRedesignTrash() {
  const { state, sidebar } = useDriveView();
  const { trash } = useDriveRedesign();

  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
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

  const selectedItems = createMemo(() => {
    const ids = selectedIds();
    return visibleItems().filter((item) => ids.has(item.id));
  });

  const clearSelection = () => setSelectedIds(new Set<string>());

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const restore = async (targets: readonly DriveTrashItem[]) => {
    if (targets.length === 0 || busy()) return;
    setBusy(true);
    try {
      const { restored, failed } = await trash.restoreItems(
        targets.map((item) => ({ id: item.id, itemType: item.itemType }))
      );
      if (restored > 0) {
        clearSelection();
        toast.success(t('drive.toastRestored', { count: restored }));
      }
      if (failed > 0) {
        toast.failure(t('drive.toastRestoreFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const deleteForever = async (targets: readonly DriveTrashItem[]) => {
    if (targets.length === 0 || busy()) return;
    const confirmed = await confirmDialog({
      title: t('drive.deleteForeverConfirmTitle', { count: targets.length }),
      body: t('drive.deleteForeverConfirmDescription'),
      confirmLabel: t('drive.deleteForever'),
      tone: 'danger',
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const { deleted, failed } = await trash.permanentlyDeleteItems(
        targets.map((item) => ({ id: item.id, itemType: item.itemType }))
      );
      if (deleted > 0) {
        clearSelection();
        toast.success(t('drive.toastDeletedForever', { count: deleted }));
      }
      if (failed > 0) {
        toast.failure(t('drive.toastDeleteForeverFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const emptyTrash = async () => {
    const all = visibleItems();
    if (all.length === 0 || busy()) return;
    const confirmed = await confirmDialog({
      title: t('drive.emptyTrashConfirmTitle'),
      body: t('drive.emptyTrashConfirmDescription', {
        count: all.length,
      }),
      confirmLabel: t('drive.emptyTrash'),
      tone: 'danger',
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const { deleted, failed } = await trash.permanentlyDeleteItems(
        all.map((item) => ({ id: item.id, itemType: item.itemType }))
      );
      if (deleted > 0) {
        clearSelection();
        toast.success(t('drive.toastDeletedForever', { count: deleted }));
      }
      if (failed > 0) {
        toast.failure(t('drive.toastDeleteForeverFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const allSelected = () =>
    visibleItems().length > 0 && selectedIds().size === visibleItems().length;

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* Contextual Trash action banner */}
      <Show when={trash.items().length > 0}>
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-edge-muted bg-panel/70 px-4 py-2 text-xs text-ink-muted">
          <Show
            when={selectedItems().length > 0}
            fallback={<span>{t('drive.emptyTrashDescription')}</span>}
          >
            <div class="flex items-center gap-2">
              <span class="font-medium text-ink">
                {t('drive.selectedSummary', { count: selectedItems().length })}
              </span>
              <Button
                variant="secondary"
                size="xs"
                disabled={busy()}
                onClick={() =>
                  fireAndForget(restore(selectedItems()), 'drive-trash-restore')
                }
              >
                <ArrowCounterClockwiseIcon
                  class="size-3.5"
                  aria-hidden="true"
                />
                <span>
                  {t('drive.restoreSelected', {
                    count: selectedItems().length,
                  })}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={busy()}
                class="text-failure-ink hover:text-failure-ink"
                onClick={() =>
                  fireAndForget(
                    deleteForever(selectedItems()),
                    'drive-trash-delete-forever'
                  )
                }
              >
                <TrashIcon class="size-3.5" aria-hidden="true" />
                <span>{t('drive.deleteForever')}</span>
              </Button>
            </div>
          </Show>

          <Button
            variant="ghost"
            size="xs"
            disabled={busy()}
            class="text-failure-ink hover:text-failure-ink"
            onClick={() => fireAndForget(emptyTrash(), 'drive-trash-empty-all')}
          >
            <TrashIcon class="size-3.5" aria-hidden="true" />
            <span>{t('drive.emptyTrash')}</span>
          </Button>
        </div>
      </Show>

      <Switch>
        <Match when={trash.error() && trash.items().length === 0}>
          <DriveRedesignEmptyState
            reason="error"
            onRetry={() => fireAndForget(trash.refresh(), 'drive-trash-retry')}
          />
        </Match>
        <Match when={trash.isLoading()}>
          <DriveContentSkeleton mode="list" label={t('drive.loadingTrash')} />
        </Match>
        <Match when={visibleItems().length === 0}>
          <DriveRedesignEmptyState
            reason={state.value().search.trim() ? 'search' : 'trash'}
            onClearSearch={() => state.setSearch('')}
          />
        </Match>
        <Match when={true}>
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Column headers */}
            <div class="flex h-9 shrink-0 items-center gap-2 border-b border-edge-muted bg-panel/60 px-3 text-xs font-medium text-ink-muted">
              <div class="flex size-5 shrink-0 items-center justify-center">
                <MultiSelectCheckbox
                  checked={allSelected()}
                  onChecked={(checked) => {
                    if (checked) {
                      setSelectedIds(
                        new Set(visibleItems().map((item) => item.id))
                      );
                    } else {
                      clearSelection();
                    }
                  }}
                />
              </div>
              <div class="min-w-0 flex-1">{t('drive.columnName')}</div>
              <div class="hidden w-36 shrink-0 md:block">
                {t('drive.columnLocation')}
              </div>
              <div class="hidden w-24 shrink-0 sm:block">
                {t('drive.columnKind')}
              </div>
              <div class="hidden w-24 shrink-0 text-right sm:block">
                {t('drive.columnTrashed')}
              </div>
              <div class="w-40 shrink-0" aria-hidden="true" />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto overscroll-none">
              <For each={visibleItems()}>
                {(item) => {
                  const nestedCount = () =>
                    hierarchy().nestedCountByFolderId.get(item.id) ?? 0;
                  const parentName = () =>
                    item.parentFolderId
                      ? foldersById().get(item.parentFolderId)
                      : undefined;
                  const kind = () =>
                    driveItemKind({
                      type: item.itemType,
                      fileType: item.fileType,
                      subType: item.subType
                        ? { type: item.subType }
                        : undefined,
                    });
                  const selected = () => selectedIds().has(item.id);

                  return (
                    <div
                      class={cn(
                        'group/trash-row flex h-11 min-w-0 items-center gap-2 border-b border-edge-muted/60 px-3 text-sm transition-colors',
                        selected() ? 'bg-accent/10' : 'hover:bg-hover/60'
                      )}
                    >
                      <div class="flex size-5 shrink-0 items-center justify-center">
                        <MultiSelectCheckbox
                          checked={selected()}
                          onChecked={() => toggleSelect(item.id)}
                        />
                      </div>
                      <div class="flex min-w-0 flex-1 items-center gap-2.5">
                        <span class="flex size-5 shrink-0 items-center justify-center opacity-75">
                          <EntityIcon
                            targetType={trashIconTarget(item)}
                            size="fill"
                          />
                        </span>
                        <Tooltip label={item.name} class="min-w-0 max-w-full">
                          <span class="min-w-0 truncate text-ink">
                            {item.name}
                          </span>
                        </Tooltip>
                        <Show when={nestedCount() > 0}>
                          <span class="shrink-0 rounded-full bg-inset px-1.5 py-0.5 text-[11px] text-ink-muted">
                            {t('drive.itemCount', { count: nestedCount() })}
                          </span>
                        </Show>
                      </div>
                      <div class="hidden w-36 shrink-0 truncate text-xs text-ink-muted md:block">
                        {parentName() ?? t('drive.unfiledLocation')}
                      </div>
                      <div class="hidden w-24 shrink-0 truncate text-xs text-ink-muted sm:block">
                        {driveKindLabel(kind())}
                      </div>
                      <div class="hidden w-24 shrink-0 text-right text-xs tabular-nums text-ink-muted sm:block">
                        <Show when={item.deletedAt}>
                          {(date) => formatRelativeTimestamp(date())}
                        </Show>
                      </div>
                      <div class="flex w-40 shrink-0 items-center justify-end gap-1">
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={busy()}
                          onClick={() =>
                            fireAndForget(
                              restore([item]),
                              'drive-trash-restore'
                            )
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
                          size="icon-xs"
                          disabled={busy()}
                          aria-label={t('drive.deleteForever')}
                          tooltip={t('drive.deleteForever')}
                          class="text-failure-ink hover:text-failure-ink"
                          onClick={() =>
                            fireAndForget(
                              deleteForever([item]),
                              'drive-trash-delete-one'
                            )
                          }
                        >
                          <TrashIcon class="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  );
                }}
              </For>

              <Show when={trash.isLoadingMore()}>
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
              <Show when={trash.hasMore() && !trash.isLoadingMore()}>
                <div class="flex justify-center py-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      fireAndForget(trash.loadMore(), 'drive-trash-load-more')
                    }
                  >
                    {t('drive.loadMore')}
                  </Button>
                </div>
              </Show>
              <div class="h-12" aria-hidden="true" />
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
