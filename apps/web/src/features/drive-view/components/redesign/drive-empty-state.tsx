import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import EmptyStateFolderGraphic from '@design/empty-state-folder.svg';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import FilePlusIcon from '@icon/system/regular/file-plus.svg';
import FolderPlusIcon from '@icon/system/regular/folder-plus.svg';
import FunnelIcon from '@icon/system/regular/funnel-simple.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Button, EmptyStatePanel } from '@ui';
import { For, Match, Switch } from 'solid-js';
import type { DriveViewMode } from '../../core/drive-view-mode';

export function DriveContentSkeleton(props: {
  mode: DriveViewMode;
  label?: string;
}) {
  return (
    <ListSkeleton.Root
      label={props.label ?? t('drive.loadingMore')}
      class="flex size-full min-h-0 flex-col p-4"
    >
      <Switch
        fallback={
          <div class="flex flex-col gap-1">
            <For each={[62, 48, 74, 55, 68, 42, 58, 70]}>
              {(width) => (
                <div class="flex h-11 items-center gap-3 rounded-lg px-3">
                  <div class="skeleton-shimmer size-5 shrink-0 rounded bg-skeleton" />
                  <div
                    class="skeleton-shimmer h-3 rounded-full bg-skeleton"
                    style={{ width: `${width}%`, 'max-width': '260px' }}
                  />
                  <div class="ml-auto hidden h-2.5 w-16 rounded-full bg-skeleton skeleton-shimmer sm:block" />
                  <div class="hidden h-2.5 w-20 rounded-full bg-skeleton skeleton-shimmer md:block" />
                </div>
              )}
            </For>
          </div>
        }
      >
        <Match when={props.mode === 'grid'}>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            <For each={[1, 2, 3, 4, 5, 6, 7, 8]}>
              {() => (
                <div class="flex flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel">
                  <div class="skeleton-shimmer h-28 w-full bg-skeleton" />
                  <div class="flex flex-col gap-2 p-3">
                    <div class="skeleton-shimmer h-3 w-3/4 rounded-full bg-skeleton" />
                    <div class="skeleton-shimmer h-2.5 w-1/2 rounded-full bg-skeleton" />
                  </div>
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.mode === 'columns'}>
          <div class="flex h-full gap-0">
            <For each={[1, 2, 3]}>
              {() => (
                <div class="flex w-64 shrink-0 flex-col gap-2 border-r border-edge-muted p-3">
                  <div class="skeleton-shimmer mb-2 h-3.5 w-28 rounded-full bg-skeleton" />
                  <For each={[1, 2, 3, 4, 5, 6]}>
                    {() => (
                      <div class="flex items-center gap-2 py-1">
                        <div class="skeleton-shimmer size-4 rounded bg-skeleton" />
                        <div class="skeleton-shimmer h-2.5 w-36 rounded-full bg-skeleton" />
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </ListSkeleton.Root>
  );
}

export type DriveEmptyReason =
  | 'my-drive'
  | 'folder'
  | 'shared'
  | 'recent'
  | 'starred'
  | 'trash'
  | 'search'
  | 'filters'
  | 'error';

export function DriveRedesignEmptyState(props: {
  reason: DriveEmptyReason;
  isInFolder?: boolean;
  onCreateDocument?: () => void;
  onCreateFolder?: () => void;
  onClearFilters?: () => void;
  onClearSearch?: () => void;
  onSearchAllDrive?: () => void;
  onBackToDrive?: () => void;
  onRetry?: () => void;
}) {
  return (
    <Switch>
      <Match when={props.reason === 'error'}>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ink-muted">
          <span>{t('drive.loadFailed')}</span>
          <Button variant="secondary" size="sm" onClick={props.onRetry}>
            {t('drive.tryAgain')}
          </Button>
        </div>
      </Match>
      <Match when={props.reason === 'search'}>
        <EmptyStatePanel
          centered
          graphic={SearchIcon}
          graphicClass="size-10 text-ink-muted"
          title={t('drive.emptySearchTitle')}
          description={t('drive.emptySearchDescription')}
          primaryAction={
            props.isInFolder && props.onSearchAllDrive
              ? {
                  label: t('drive.searchAllDrive'),
                  icon: SearchIcon,
                  onClick: props.onSearchAllDrive,
                }
              : props.onClearSearch
                ? {
                    label: t('drive.clearSearch'),
                    onClick: props.onClearSearch,
                  }
                : undefined
          }
          secondaryAction={
            props.isInFolder && props.onClearSearch
              ? {
                  label: t('drive.clearSearch'),
                  onClick: props.onClearSearch,
                }
              : undefined
          }
        />
      </Match>
      <Match when={props.reason === 'filters'}>
        <EmptyStatePanel
          centered
          graphic={FunnelIcon}
          graphicClass="size-10 text-ink-muted"
          title={t('drive.emptyFilterTitle')}
          description={t('drive.emptyFilterDescription')}
          primaryAction={
            props.onClearFilters
              ? {
                  label: t('drive.clearAllFilters'),
                  onClick: props.onClearFilters,
                }
              : undefined
          }
        />
      </Match>
      <Match when={props.reason === 'folder'}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateFolderGraphic}
          title={t('drive.emptyFolderTitle')}
          description={t('drive.emptyFolderDescription')}
          primaryAction={
            props.onCreateDocument
              ? {
                  label: t('drive.createDocument'),
                  icon: FilePlusIcon,
                  onClick: props.onCreateDocument,
                }
              : undefined
          }
          secondaryAction={
            props.onCreateFolder
              ? {
                  label: t('drive.newSubfolder'),
                  icon: FolderPlusIcon,
                  onClick: props.onCreateFolder,
                }
              : props.onBackToDrive
                ? {
                    label: t('drive.backToDrive'),
                    icon: ArrowLeftIcon,
                    onClick: props.onBackToDrive,
                  }
                : undefined
          }
        />
      </Match>
      <Match when={props.reason === 'shared'}>
        <EmptyStatePanel
          centered
          graphic={UsersIcon}
          graphicClass="size-10 text-ink-muted"
          title={t('drive.emptySharedTitle')}
          description={t('drive.emptySharedDescription')}
        />
      </Match>
      <Match when={props.reason === 'recent'}>
        <EmptyStatePanel
          centered
          title={t('drive.emptyRecentTitle')}
          description={t('drive.emptyRecentDescription')}
          primaryAction={
            props.onCreateDocument
              ? {
                  label: t('drive.createDocument'),
                  icon: FilePlusIcon,
                  onClick: props.onCreateDocument,
                }
              : undefined
          }
        />
      </Match>
      <Match when={props.reason === 'starred'}>
        <EmptyStatePanel
          centered
          graphic={StarIcon}
          graphicClass="size-10 text-ink-muted"
          title={t('drive.emptyStarredTitle')}
          description={t('drive.emptyStarredDescription')}
          primaryAction={
            props.onBackToDrive
              ? {
                  label: t('drive.backToDrive'),
                  icon: ArrowLeftIcon,
                  onClick: props.onBackToDrive,
                }
              : undefined
          }
        />
      </Match>
      <Match when={props.reason === 'trash'}>
        <EmptyStatePanel
          centered
          graphic={TrashIcon}
          graphicClass="size-10 text-ink-muted"
          title={t('drive.emptyTrashTitle')}
          description={t('drive.emptyTrashDescription')}
        />
      </Match>
      <Match when={true}>
        <EmptyStatePanel
          centered
          graphic={EmptyStateFolderGraphic}
          title={t('drive.emptyMyDriveTitle')}
          description={t('drive.emptyMyDriveDescription')}
          primaryAction={
            props.onCreateDocument
              ? {
                  label: t('drive.createDocument'),
                  icon: FilePlusIcon,
                  onClick: props.onCreateDocument,
                }
              : undefined
          }
          secondaryAction={
            props.onCreateFolder
              ? {
                  label: t('drive.newFolderInline'),
                  icon: FolderPlusIcon,
                  onClick: props.onCreateFolder,
                }
              : undefined
          }
        />
      </Match>
    </Switch>
  );
}
