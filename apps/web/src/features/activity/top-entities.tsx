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
  return (
    <section class="min-w-0" aria-labelledby="activity-top-entities-heading">
      <h2
        id="activity-top-entities-heading"
        class="mb-3 text-[11px] text-ink-extra-muted"
      >
        Most active
      </h2>
      <Show
        when={props.entities.length > 0}
        fallback={<p class="text-ink-extra-muted text-xs">No entities yet.</p>}
      >
        <div class="flex gap-2 overflow-x-auto scrollbar-hidden">
          <For each={props.entities}>
            {(entity) => <TopEntityCard entity={entity} />}
          </For>
        </div>
      </Show>
    </section>
  );
}

function TopEntityCard(props: { entity: EntityRank }) {
  const displayType = () => displayEntityType(props.entity.entityType);

  return (
    <article class="w-44 shrink-0 rounded-xl bg-inset px-3.5 py-3 ring ring-edge-muted">
      <div class="min-w-0 truncate text-xs text-ink-muted [&>*]:min-w-0">
        <Show
          when={displayType()}
          fallback={
            <span class="text-ink-extra-muted">{props.entity.entityType}</span>
          }
        >
          {(type) => (
            <MappedEntityName
              entityId={props.entity.entityId}
              entityType={type()}
            />
          )}
        </Show>
      </div>
      <p class="mt-2 font-medium text-ink text-xl tabular-nums tracking-tight">
        {props.entity.count.toLocaleString()}
      </p>
    </article>
  );
}

function MappedEntityName(props: { entityId: string; entityType: EntityType }) {
  const display = usePropertyEntityDisplay(
    () => props.entityId,
    () => props.entityType
  );
  return <EntityMention entityId={props.entityId} display={display} />;
}
