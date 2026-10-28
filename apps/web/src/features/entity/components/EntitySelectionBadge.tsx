import { EntityIcon, getEntityIconType } from '@core/component/EntityIcon';
import { Badge, Tooltip } from '@ui';
import { EntityTitle } from '../extractors/entity-title';
import type { EntityData } from '../types/entity';

/** Compact selected-item identity shared by action menus and dialogs. */
export function EntitySelectionBadge(props: { entity: EntityData }) {
  return (
    <Tooltip label={props.entity.name ?? 'Untitled'} class="min-w-0 max-w-48">
      <Badge variant="outline" size="sm" class="min-w-0 max-w-full shrink">
        <span class="size-3.5 shrink-0">
          <EntityIcon
            targetType={getEntityIconType(props.entity)}
            size="fill"
          />
        </span>
        <EntityTitle entity={props.entity} />
      </Badge>
    </Tooltip>
  );
}
