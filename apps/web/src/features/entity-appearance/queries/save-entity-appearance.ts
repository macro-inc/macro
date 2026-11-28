import { catchToResult } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/host/types';
import { getUnmaintainedGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { setOtherEntityAppearance } from '@service-storage/entity-appearance';
import type { GraphqlAppearanceColor } from '@service-storage/graphql/generated/graphql';
import { setGraphqlEntityAppearance } from '@service-storage/graphql-entity-mutations';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type {
  AppearanceColor,
  AppearanceEntityType,
  EntityAppearance,
} from '../core/appearance';

const colors = {
  gray: 'GRAY',
  red: 'RED',
  tomato: 'TOMATO',
  orange: 'ORANGE',
  amber: 'AMBER',
  yellow: 'YELLOW',
  green: 'GREEN',
  teal: 'TEAL',
  blue: 'BLUE',
  indigo: 'INDIGO',
  purple: 'PURPLE',
  pink: 'PINK',
} satisfies Record<AppearanceColor, GraphqlAppearanceColor>;

type AppearanceSettlement = 'committed' | 'permanently-failed' | undefined;

export type AppearanceWriteReceipt = {
  queued: boolean;
  listReadFailed: boolean;
  settlement?: Promise<AppearanceSettlement>;
};

function observeAppearanceSettlement(host: CacheHost, uuid: string) {
  const { promise, resolve } = Promise.withResolvers<AppearanceSettlement>();
  function finish(status: AppearanceSettlement) {
    stopSettlements();
    stopGeneration();
    resolve(status);
  }
  const stopSettlements = host.onMutationSettled((result) => {
    if (result.mutationUuid === uuid)
      finish(result.status === 'superseded' ? undefined : result.status);
  });
  const stopGeneration = host.onCacheGenerationChanged((change) => {
    if (change.queue === 'reset') finish(undefined);
  });
  return { promise, stop: () => finish(undefined) };
}

export async function updateEntityAppearance(
  type: AppearanceEntityType,
  id: string,
  appearance: EntityAppearance
) {
  if (type !== 'document' && type !== 'initiative') {
    return (
      await setOtherEntityAppearance(
        type === 'routine' ? 'scheduled_action' : type,
        id,
        appearance
      )
    ).map(() => undefined);
  }
  return catchToResult(async (): Promise<AppearanceWriteReceipt> => {
    // Subscribe before sending so a fast replay cannot outrun the listener.
    getGraphqlSoupClient();
    const host = getGraphqlCacheHost();
    const uuid = host && crypto.randomUUID();
    const observed = host && uuid && observeAppearanceSettlement(host, uuid);
    let queued = false;
    const icon = appearance.icon;
    try {
      const result = await setGraphqlEntityAppearance(
        {
          entity: { type: type === 'document' ? 'DOCUMENT' : 'INITIATIVE', id },
          icon:
            icon?.kind === 'emoji'
              ? { emoji: icon.value }
              : icon && { macro: icon.name },
          color: appearance.color ? colors[appearance.color] : null,
        },
        getUnmaintainedGraphqlSoupRevalidations(),
        uuid
      );
      queued = result.queued;
      return {
        queued,
        listReadFailed: !queued && !result.listsReadAgain,
        settlement: observed ? observed.promise : undefined,
      };
    } finally {
      if (!queued && observed) observed.stop();
    }
  });
}
