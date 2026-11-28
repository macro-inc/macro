import { catchToResult } from '@core/util/result';
import { getUnmaintainedGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { setOtherEntityAppearance } from '@service-storage/entity-appearance';
import type { GraphqlAppearanceColor } from '@service-storage/graphql/generated/graphql';
import {
  type AppearanceSettlement,
  setGraphqlEntityAppearance,
} from '@service-storage/graphql-entity-mutations';
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

export type AppearanceWriteReceipt = {
  queued: boolean;
  listReadFailed: boolean;
  settlement?: Promise<AppearanceSettlement>;
};

export async function updateEntityAppearance(
  type: AppearanceEntityType,
  id: string,
  appearance: EntityAppearance,
  isCurrent: () => boolean
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
    const icon = appearance.icon;
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
      isCurrent
    );
    return {
      queued: result.queued,
      listReadFailed: !result.queued && !result.listsReadAgain,
      settlement: result.settlement,
    };
  });
}
