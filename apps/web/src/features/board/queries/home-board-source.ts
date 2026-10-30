import { useHomeDataSource } from '@app/features/home/queries/use-home-query';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData, WithNotification } from '@entity';
import { type Accessor, createMemo } from 'solid-js';
import type { BoardSource } from '../context/board-context';
import type { BoardItem } from '../core/item';
import { type BoardItemResolvers, toBoardItem } from './entity-board-items';

/**
 * The board shows Home's desktop Signal feed, read from the same source as
 * Home's list: the conversations, mail, documents and runs Home lists, with
 * their notifications attached so items update live. `entity` returns the
 * feed entity behind a board item, for opening it.
 */
export function createHomeBoardSource(resolvers: Accessor<BoardItemResolvers>) {
  const home = useHomeDataSource({
    tab: 'signal',
    search: '',
    groupBy: 'none',
    facets: {},
  });

  const entities = createMemo((): WithNotification<EntityData>[] =>
    home.items().flatMap((row) => (row.kind === 'entity' ? [row.entity] : []))
  );

  const entityByKey = createMemo(
    () =>
      new Map(
        entities().map((entity) => [`${entity.type}:${entity.id}`, entity])
      )
  );

  const items = createMemo((): BoardItem[] => {
    const resolve = resolvers();
    return entities().flatMap((entity) => toBoardItem(entity, resolve) ?? []);
  });

  const source: BoardSource = {
    items,
    state: () => {
      if (home.isLoading()) return 'loading';
      return home.error() ? 'error' : 'ready';
    },
    retry: () => fireAndForget(home.refresh(), 'board'),
    older: {
      hasMore: home.hasMore,
      loading: home.isLoadingMore,
      load: () => fireAndForget(home.loadMore(), 'board'),
    },
  };

  return {
    source,
    entity: (key: string) => entityByKey().get(key),
  };
}
