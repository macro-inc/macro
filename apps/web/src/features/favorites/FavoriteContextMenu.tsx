import { globalSplitManager } from '@app/signal/splitLayout';
import { favoriteSplitContent } from '@app/util/favorites';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  ContextMenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
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
    });
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
              text="Open in new split"
              disabled={!canOpenInNewSplit()}
              onClick={() => {
                if (canOpenInNewSplit()) openFavorite(true);
              }}
            />
            <Show when={canOpenFullscreen()}>
              <MenuItem
                text="Open fullscreen"
                onClick={() => {
                  layout.replaceAllSplits(content(), {
                    referredFrom: 'sidebar',
                  });
                  globalSplitManager()?.returnFocus();
                }}
              />
            </Show>
            <MenuItem
              text="Open in current split"
              onClick={() => openFavorite(false)}
            />
          </MenuGroup>
          {props.additionalActions}
          <MenuSeparator />
          <MenuGroup>
            <MenuItem
              text="Remove from favorites"
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
