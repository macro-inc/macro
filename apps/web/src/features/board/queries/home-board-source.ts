import { useHomeEntitiesQuery } from '@app/features/home/queries/use-home-query';
import { t } from '@app/lib/i18n';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData, WithNotification } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { createMemo } from 'solid-js';
import type { BoardSource } from '../context/board-context';
import type { BoardItem } from '../core/item';
import { type BoardItemResolvers, toBoardItem } from './entity-board-items';

const localPart = (id: string) =>
  id.replace(/^macro\|/, '').split('@')[0] || id;

/**
 * The board shows Home's Signal feed: the conversations, mail, documents and
 * runs Home lists, with their notifications attached so items update live.
 * `entity` returns the feed entity behind a board item, for opening it.
 */
export function createHomeBoardSource() {
  const home = useHomeEntitiesQuery({ tab: 'signal', facets: {} });
  const viewerId = useUserId();
  const channels = useChannelsContext();

  const resolvers = (): BoardItemResolvers => ({
    viewerId: viewerId(),
    userName: (id) =>
      getDisplayName(tryMacroId(id), { emailFallback: 'local-part' }) ||
      localPart(id),
    botName: (id) => getBotDisplayName(id),
    channelName: (id, fallback) =>
      channels.channelsById()[id]?.name?.trim() || fallback,
    updatedText: t('board.updated'),
    threadContext: (channel) => t('board.threadIn', { channel }),
  });

  const entities = createMemo((): WithNotification<EntityData>[] =>
    queryReadyGate(home.query)
      ? home.transformEntities(home.query.data.entities)
      : []
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
      if (home.awaitingViewer() || home.query.isPending) return 'loading';
      if (home.query.error && items().length === 0) return 'error';
      return 'ready';
    },
    retry: () => fireAndForget(home.query.refresh(), 'board'),
  };

  return {
    source,
    entity: (key: string) => entityByKey().get(key),
  };
}
