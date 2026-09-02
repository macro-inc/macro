import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  TopEntities as TopEntitiesView,
  TopEntityBody,
} from '../components/top-entities';
import type { ActivityTopEntity } from '../core/event';
import { useActivityDeps } from '../deps';
import { createEntityOpener } from '../state/entity-opener';

function MappedTopEntityRow(props: {
  entity: ActivityTopEntity;
  entityType: EntityType;
}) {
  const deps = useActivityDeps();
  const opener = createEntityOpener(
    deps,
    () => props.entity.entityId,
    () => props.entityType
  );
  return (
    <TopEntityBody
      entity={props.entity}
      display={opener.display}
      rowProps={opener.handlers}
    />
  );
}

/** Most-active list with click-to-open wired by the view layer. */
export function TopEntities(props: { entities: ActivityTopEntity[] }) {
  return (
    <TopEntitiesView entities={props.entities} mappedRow={MappedTopEntityRow} />
  );
}
