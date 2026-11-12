import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { favoriteSplitContent } from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  canOpenInNewTab,
  openInNewTab,
} from '@components/app/tab-layout/open-in-new-tab';
import {
  ContextMenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import ArrowsOutIcon from '@icon/system/regular/arrows-out.svg';
import SplitIcon from '@icon/system/regular/columns.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TabIcon from '@icon/system/regular/tabs.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { useRemoveFavoriteMutation } from '@queries/favorites/favorites';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { cn } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';

type FavoriteContextMenuProps = ParentProps<{
  favorite: Favorite;
  additionalActions?: JSX.Element;
  triggerClass?: string;
  onOpenChange?: (open: boolean) => void;
}>;

/** Shared navigation and removal menu for favorite rows. */
export function FavoriteContextMenu(props: FavoriteContextMenuProps) {
  const layout = useSplitLayout();
  const removeMutation = useRemoveFavoriteMutation();
  const content = () => favoriteSplitContent(props.favorite);
  const openFavorite = (preferNewSplit: boolean) => {
    const split = layout.openWithSplit(content(), {
      referredFrom: 'sidebar',
      activate: true,
      preferNewSplit,
      allowDuplicate: props.favorite.entityType === 'foreign_entity',
    }).split;
    globalSplitManager()?.returnFocus();
    return split;
  };
  const canOpenInNewSplit = () =>
    globalSplitManager()?.canAppendSplit() ?? false;
  const canOpenFullscreen = () => layout.getSplitCount() > 1;

  return (
    <ContextMenu onOpenChange={props.onOpenChange}>
      <ContextMenu.Trigger class={cn('w-full', props.triggerClass)}>
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent class="text-xs text-ink-muted">
          <MenuGroup>
            <MenuItem
              text={t('entityActions.openInNewSplit')}
              icon={SplitIcon}
              disabled={!canOpenInNewSplit()}
              onClick={() => {
                if (canOpenInNewSplit()) openFavorite(true);
              }}
            />
            <Show when={canOpenInNewTab()}>
              <MenuItem
                text={t('entityActions.openInNewTab')}
                icon={TabIcon}
                onClick={() => openInNewTab(() => openFavorite(false))}
              />
            </Show>
            <Show when={canOpenFullscreen()}>
              <MenuItem
                text={t('entityActions.openFullscreen')}
                icon={ArrowsOutIcon}
                onClick={() => {
                  layout.replaceAllSplits(content(), {
                    referredFrom: 'sidebar',
                  });
                  globalSplitManager()?.returnFocus();
                }}
              />
            </Show>
            <MenuItem
              text={t('entityActions.openInCurrentSplit')}
              icon={ArrowRightIcon}
              onClick={() => openFavorite(false)}
            />
          </MenuGroup>
          {props.additionalActions}
          <MenuSeparator />
          <MenuGroup>
            <MenuItem
              text={t('entityActions.removeFromFavorites')}
              icon={StarIcon}
              onClick={() =>
                removeMutation.mutate({
                  entityType: props.favorite.entityType,
                  entityId: props.favorite.entityId,
                })
              }
            />
          </MenuGroup>
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
