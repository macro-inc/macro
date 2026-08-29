import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { ActivityTopEntity } from '../domain/event';
import {
  TopEntities as TopEntitiesView,
  TopEntityBody,
} from '../ui/top-entities';
import { OpenEntity } from './open-entity';

function MappedTopEntityRow(props: {
  entity: ActivityTopEntity;
  entityType: EntityType;
}) {
  return (
    <OpenEntity entityId={props.entity.entityId} entityType={props.entityType}>
      {({ display, handlers }) => (
        <TopEntityBody
          entity={props.entity}
          display={display}
          rowProps={handlers}
        />
      )}
    </OpenEntity>
  );
}

/** Most-active list with click-to-open wired by the view layer. */
export function TopEntities(props: { entities: ActivityTopEntity[] }) {
  return (
    <TopEntitiesView entities={props.entities} mappedRow={MappedTopEntityRow} />
  );
}
