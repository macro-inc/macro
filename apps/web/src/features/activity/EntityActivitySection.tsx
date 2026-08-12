import { SidePanel } from '@components/app/side-panel/SidePanel';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import {
  type ActivityEvent,
  createEntityActivityQuery,
} from '@queries/activity/graphql/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { For, Show, Suspense } from 'solid-js';
import { ActionPhrase } from './action-phrase';
import { ActorName } from './actor-name';
import { useEntityActivityFlag } from './use-entity-activity-flag';

export interface EntityActivitySectionProps {
  entityId: string;
  entityType: EntityType;
  order?: number;
}

/**
 * The side-panel Activity section, mounted only when the feature flag is on
 * so the activity query is never issued while the rollout is off.
 */
export function EntityActivitySectionConditional(
  props: EntityActivitySectionProps
) {
  const enabled = useEntityActivityFlag();
  return (
    <Show when={enabled()}>
      <EntityActivitySection {...props} />
    </Show>
  );
}

function EntityActivitySection(props: EntityActivitySectionProps) {
  const query = createEntityActivityQuery({
    entityType: () => props.entityType,
    entityId: () => props.entityId,
    enabled: () => true,
  });
  const events = () => query.result.data ?? [];

  return (
    <Show when={query.isEnabled()}>
      <SidePanel.Section id="activity" title="Activity" order={props.order}>
        <Suspense fallback={<SidePanel.Loading />}>
          <Show
            when={events().length > 0}
            fallback={<SidePanel.EmptyPill label="No activity yet" />}
          >
            <div class="relative px-1 text-xs">
              <div class="absolute inset-y-2 left-[7px] w-px bg-edge-muted" />
              <For each={events()}>{(event) => <RailRow event={event} />}</For>
            </div>
          </Show>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}

/** History rail: dots on a connected line, like an issue timeline. */
function RailRow(props: { event: ActivityEvent }) {
  return (
    <div class="relative flex min-h-6 min-w-0 items-center gap-1 py-0.5 pl-4">
      <span class="absolute left-[5px] size-[5px] rounded-full bg-ink-extra-muted" />
      <span class="shrink-0 font-medium text-ink">
        <ActorName actorId={props.event.actorId} />
      </span>
      <span class="min-w-0 truncate text-ink-muted">
        <ActionPhrase event={props.event} />
      </span>
      <span class="ml-auto shrink-0 text-ink-extra-muted">
        {formatRelativeTimestamp(new Date(props.event.occurredAt), {
          condensed: true,
        })}
      </span>
    </div>
  );
}
