import { usePropertyEntityDisplay } from '@property/hooks';
import type { ActivityOverview } from '@queries/activity/graphql/overview';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo, For, Show } from 'solid-js';
import { displayEntityType } from './display-entity-type';
import { EntityMention } from './entity-mention';

type EntityRank = ActivityOverview['topEntities'][number];
type DisplayableEntityRank = EntityRank & { displayType: EntityType };

export function TopEntities(props: {
  entities: ActivityOverview['topEntities'];
}) {
  const rows = createMemo<DisplayableEntityRank[]>(() =>
    props.entities.flatMap((entity) => {
      const displayType = displayEntityType(entity.entityType);
      return displayType ? [{ ...entity, displayType }] : [];
    })
  );
  const maxCount = () => rows()[0]?.count ?? 0;

  return (
    <section class="min-w-0" aria-labelledby="activity-top-entities-heading">
      <h2
        id="activity-top-entities-heading"
        class="mb-3 font-medium text-ink text-sm"
      >
        Most active
      </h2>
      <Show
        when={rows().length > 0}
        fallback={<p class="text-ink-extra-muted text-xs">No entities yet.</p>}
      >
        <div class="flex flex-col gap-1.5">
          <For each={rows()}>
            {(entity) => <TopEntityRow entity={entity} maxCount={maxCount()} />}
          </For>
        </div>
      </Show>
    </section>
  );
}

function TopEntityRow(props: {
  entity: DisplayableEntityRank;
  maxCount: number;
}) {
  const display = usePropertyEntityDisplay(
    () => props.entity.entityId,
    () => props.entity.displayType
  );
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
          <EntityMention entityId={props.entity.entityId} display={display} />
        </span>
        <span class="shrink-0 tabular-nums text-ink-muted">
          {props.entity.count.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
