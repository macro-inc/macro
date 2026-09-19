import type { ListController, ListDataSource } from '@app/components/list';
import { isListViewID, type ListView } from '@app/constants/list-views';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { registerHotkey } from '@core/hotkey/hotkeys';
import type { EntityData } from '@entity';
import type { SoupRow } from './types';

const LOAD_MORE_DISTANCE_FROM_END = 3;

export type SoupListNavigationOpenOptions = {
  mergeHistory: true;
  referredFrom: ListView;
};

export type UseSoupListNavigationHotkeysOptions<TEntity extends EntityData> = {
  splitHotkeyScope: string;
  viewId: ListView;
  dataSource: ListDataSource<SoupRow<TEntity>>;
  controller: Pick<ListController<SoupRow<TEntity>>, 'navigate' | 'selection'>;
  handle: SplitHandle;
  openEntityInSplit: (
    entity: TEntity,
    options: SoupListNavigationOpenOptions
  ) => void;
};

export function useSoupListNavigationHotkeys<TEntity extends EntityData>(
  options: UseSoupListNavigationHotkeysOptions<TEntity>
) {
  const canNavigate = () => {
    const content = options.handle.content();
    return (
      (content.type !== 'component' || !isListViewID(content.id)) &&
      options.handle.referredFrom() === options.viewId
    );
  };

  const step = (direction: -1 | 1) => {
    if (!canNavigate()) return false;

    const rows = options.dataSource.items();
    const next = options.controller.navigate.by(direction, {
      isNavigable: (row) => row.kind === 'entity',
    });

    if (next?.item.kind === 'entity') {
      options.controller.selection.setAnchor(next.key);
      options.openEntityInSplit(next.item.entity, {
        mergeHistory: true,
        referredFrom: options.viewId,
      });
    }

    if (
      direction === 1 &&
      (!next || rows.length - next.index - 1 <= LOAD_MORE_DISTANCE_FROM_END) &&
      options.dataSource.hasMore() &&
      !options.dataSource.isLoadingMore()
    ) {
      void options.dataSource.loadMore();
    }

    return true;
  };

  registerHotkey({
    scopeId: options.splitHotkeyScope,
    hotkey: 'j',
    description: 'Move down',
    condition: canNavigate,
    keyDownHandler: () => step(1),
    registrationType: 'add',
    hide: true,
  });

  registerHotkey({
    scopeId: options.splitHotkeyScope,
    hotkey: 'k',
    description: 'Move up',
    condition: canNavigate,
    keyDownHandler: () => step(-1),
    registrationType: 'add',
    hide: true,
  });
}
