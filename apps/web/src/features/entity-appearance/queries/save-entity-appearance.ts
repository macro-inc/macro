import { catchToResult } from '@core/util/result';
import { getUnmaintainedGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { refreshAfterWrite } from '@queries/storage/entity-mutations';
import { setOtherEntityAppearance } from '@service-storage/entity-appearance';
import type { GraphqlAppearanceColor } from '@service-storage/graphql/generated/graphql';
import { setGraphqlEntityAppearance } from '@service-storage/graphql-entity-mutations';
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
  return catchToResult(async () => {
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
      getUnmaintainedGraphqlSoupRevalidations()
    );
    const effectsResolved = result.effectsResolved && result.effects.length > 0;
    if (
      isCurrent() &&
      ((!result.queued && !result.revalidationsQueued) || !effectsResolved)
    )
      refreshAfterWrite({ ...result, effectsResolved });
    return {
      queued: result.queued,
      listReadFailed: !result.queued && !result.listsReadAgain,
    };
  });
}
