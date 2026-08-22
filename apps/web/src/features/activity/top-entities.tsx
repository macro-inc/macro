import { SidePanel } from '@components/app/side-panel/SidePanel';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { ActivityOverview } from '@queries/activity/graphql/overview';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { displayEntityType } from './display-entity-type';
import { EntityMention } from './entity-mention';

type EntityRank = ActivityOverview['topEntities'][number];

/**
 * The entities the viewer touched most, as a horizontal strip of side-panel
 * pills — entity mention plus the soup group count badge — at the same content
 * width as the graph above and the timeline below.
 */
export function TopEntities(props: {
  entities: ActivityOverview['topEntities'];
}) {
  return (
    <section class="min-w-0" aria-labelledby="activity-top-entities-heading">
      <h2
        id="activity-top-entities-heading"
        class="px-2 pb-1 font-semibold text-ink-muted text-xs"
      >
        Most active
      </h2>
      <Show
        when={props.entities.length > 0}
        fallback={
          <p class="px-2 text-ink-extra-muted text-xs">No entities yet.</p>
        }
      >
        <div class="flex gap-1 overflow-x-auto scrollbar-hidden">
          <For each={props.entities}>
            {(entity) => <TopEntityPill entity={entity} />}
          </For>
        </div>
      </Show>
    </section>
  );
}

function TopEntityPill(props: { entity: EntityRank }) {
  const displayType = () => displayEntityType(props.entity.entityType);

  return (
    <div
      class={cn(
        SidePanel.pillClass,
        'shrink-0 border border-edge-muted bg-inset text-xs'
      )}
    >
      <span class="min-w-0 truncate text-ink-muted [&>*]:min-w-0">
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
      </span>
      <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px font-medium text-ink-extra-muted tabular-nums">
        {props.entity.count.toLocaleString()}
      </span>
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
