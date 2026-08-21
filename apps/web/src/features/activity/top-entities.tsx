import { usePropertyEntityDisplay } from '@property/hooks';
import type { ActivityOverview } from '@queries/activity/graphql/overview';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { For, Show } from 'solid-js';
import { displayEntityType } from './display-entity-type';
import { EntityMention } from './entity-mention';

type EntityRank = ActivityOverview['topEntities'][number];

export function TopEntities(props: {
  entities: ActivityOverview['topEntities'];
}) {
  const maxCount = () => props.entities[0]?.count ?? 0;

  return (
    <section class="min-w-0" aria-labelledby="activity-top-entities-heading">
      <h2
        id="activity-top-entities-heading"
        class="mb-3 font-medium text-ink text-sm"
      >
        Most active
      </h2>
      <Show
        when={props.entities.length > 0}
        fallback={<p class="text-ink-extra-muted text-xs">No entities yet.</p>}
      >
        <div class="flex flex-col gap-1.5">
          <For each={props.entities}>
            {(entity) => <TopEntityRow entity={entity} maxCount={maxCount()} />}
          </For>
        </div>
      </Show>
    </section>
  );
}

function TopEntityRow(props: { entity: EntityRank; maxCount: number }) {
  const displayType = () => displayEntityType(props.entity.entityType);
  const width = () =>
    props.maxCount > 0
      ? `${(props.entity.count / props.maxCount) * 100}%`
      : '0%';

  return (
    <div class="relative min-w-0 overflow-hidden rounded-md ring ring-edge-muted">
      <div
        class="absolute inset-y-0 left-0 bg-activity-1"
        style={{ width: width() }}
      />
      <div class="relative flex min-h-7 min-w-0 items-center gap-2 px-2 py-1 text-xs">
        <span class="min-w-0 flex-1 truncate">
          <Show
            when={displayType()}
            fallback={
              <span class="text-ink-muted">{props.entity.entityType}</span>
            }
          >
            {(type) => (
              <MappedEntityName
                entityId={props.entity.entityId}
                entityType={type()}
              />
            )}
          </Show>
        </span>
        <span class="shrink-0 tabular-nums text-ink-muted">
          {props.entity.count.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function MappedEntityName(props: { entityId: string; entityType: EntityType }) {
  const display = usePropertyEntityDisplay(
    () => props.entityId,
    () => props.entityType
  );
  return <EntityMention entityId={props.entityId} display={display} />;
}
