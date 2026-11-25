import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { t } from '@app/lib/i18n';
import { useFavoriteDisplayName } from '@app/util/favorites';
import { fireAndForget } from '@core/util/fireAndForget';
import StarFillIcon from '@icon/system/fill/star-fill.svg';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Button, Tooltip } from '@ui';
import { type Accessor, createMemo, For, mapArray, Show } from 'solid-js';
import { DriveRedesignEmptyState } from '../../components/redesign/drive-empty-state';
import { driveKindLabel } from '../../components/redesign/kind-label';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import { driveItemKind } from '../../core/drive-items';

type ResolvedFavorite = {
  favorite: Favorite;
  name: Accessor<string>;
};

function StarredRow(props: ResolvedFavorite) {
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
      class="group/star-row flex h-11 min-w-0 items-center gap-3 border-b border-edge-muted/60 px-4 text-sm transition-colors hover:bg-hover/60"
      onClick={(event) =>
        actions.openFavorite(props.favorite, props.name(), event)
      }
    >
      <FavoriteIcon favorite={props.favorite} class="size-5 shrink-0" />
      <Tooltip label={props.name()} class="min-w-0 flex-1">
        <span class="min-w-0 flex-1 truncate font-medium text-ink">
          {props.name()}
        </span>
      </Tooltip>
      <span class="hidden w-28 shrink-0 text-xs text-ink-muted sm:block">
        {driveKindLabel(kind())}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('drive.unstar')}
        tooltip={t('drive.unstar')}
        onClick={(event) => {
          event.stopPropagation();
          fireAndForget(
            host.unstarFavorite(props.favorite),
            'drive-starred-unstar'
          );
        }}
      >
        <StarFillIcon class="size-3.5 text-warning" aria-hidden="true" />
      </Button>
    </div>
  );
}

function StarredGridCard(props: ResolvedFavorite) {
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
      class="group/star-card relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel transition-colors hover:border-edge"
      onClick={(event) =>
        actions.openFavorite(props.favorite, props.name(), event)
      }
    >
      <div class="relative flex h-24 items-center justify-center border-b border-edge-muted/70 bg-inset/60">
        <div class="flex size-12 items-center justify-center rounded-xl border border-edge-muted bg-surface shadow-xs">
          <FavoriteIcon favorite={props.favorite} class="size-6" />
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('drive.unstar')}
          tooltip={t('drive.unstar')}
          class="absolute top-2 right-2 bg-surface/85"
          onClick={(event) => {
            event.stopPropagation();
            fireAndForget(
              host.unstarFavorite(props.favorite),
              'drive-starred-unstar-card'
            );
          }}
        >
          <StarFillIcon class="size-3.5 text-warning" aria-hidden="true" />
        </Button>
      </div>
      <div class="flex flex-col gap-1 p-3">
        <Tooltip label={props.name()} class="min-w-0 max-w-full">
          <div class="line-clamp-2 min-h-[2.25rem] text-sm leading-snug font-medium text-ink">
            {props.name()}
          </div>
        </Tooltip>
        <span class="text-[11px] text-ink-muted">{driveKindLabel(kind())}</span>
      </div>
    </div>
  );
}

export function DriveRedesignStarred() {
  const { state, sidebar } = useDriveView();
  const { preferences } = useDriveRedesign();

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
      <Show
        when={preferences.viewMode() === 'grid'}
        fallback={
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-none">
            <For each={filtered()}>
              {(entry) => (
                <StarredRow favorite={entry.favorite} name={entry.name} />
              )}
            </For>
          </div>
        }
      >
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-none p-4">
          <div class="grid grid-cols-[repeat(auto-fill,minmax(216px,1fr))] gap-3">
            <For each={filtered()}>
              {(entry) => (
                <StarredGridCard favorite={entry.favorite} name={entry.name} />
              )}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  );
}
