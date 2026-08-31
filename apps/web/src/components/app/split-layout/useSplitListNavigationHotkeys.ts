import { isListViewID, type ListView } from '@app/constants/list-views';
import { registerHotkey } from '@core/hotkey/hotkeys';
import type { EntityData } from '@entity';
import type { SplitListBinding } from './context';
import type { SplitHandle } from './layoutManager';

const LOAD_MORE_DISTANCE_FROM_END = 3;

export type SplitListOpenEntityOptions = {
  mergeHistory: true;
  referredFrom: ListView;
};

export type UseSplitListNavigationHotkeysOptions = {
  splitHotkeyScope: string;
  list: () => SplitListBinding | undefined;
  handle: SplitHandle;
  openEntityInSplit: (
    entity: EntityData,
    options: SplitListOpenEntityOptions
  ) => void;
};

type ConfiguredSplitListBinding = SplitListBinding & {
  viewId: ListView;
};

export function useSplitListNavigationHotkeys(
  options: UseSplitListNavigationHotkeysOptions
) {
  const canNavigate = (
    list: SplitListBinding | undefined
  ): list is ConfiguredSplitListBinding => {
    const content = options.handle.content();
    return (
      list?.viewId !== undefined &&
      (content.type !== 'component' || !isListViewID(content.id)) &&
      options.handle.referredFrom() === list.viewId
    );
  };

  const step = (direction: -1 | 1) => {
    const list = options.list();
    if (!canNavigate(list)) return false;

    const rows = list.dataSource.items();
    const next = list.controller.navigate.by(direction, {
      isNavigable: (row) => row.kind === 'entity',
    });

    if (next?.item.kind === 'entity') {
      list.controller.selection.setAnchor(next.key);
      options.openEntityInSplit(next.item.entity, {
        mergeHistory: true,
        referredFrom: list.viewId,
      });
    }

    if (
      direction === 1 &&
      (!next || rows.length - next.index - 1 <= LOAD_MORE_DISTANCE_FROM_END) &&
      list.dataSource.hasMore() &&
      !list.dataSource.isLoadingMore()
    ) {
      void list.dataSource.loadMore();
    }

    return true;
  };

  registerHotkey({
    scopeId: options.splitHotkeyScope,
    hotkey: 'j',
    description: 'Move down',
    condition: () => canNavigate(options.list()),
    keyDownHandler: () => step(1),
    registrationType: 'add',
    hide: true,
  });

  registerHotkey({
    scopeId: options.splitHotkeyScope,
    hotkey: 'k',
    description: 'Move up',
    condition: () => canNavigate(options.list()),
    keyDownHandler: () => step(-1),
    registrationType: 'add',
    hide: true,
  });
}
