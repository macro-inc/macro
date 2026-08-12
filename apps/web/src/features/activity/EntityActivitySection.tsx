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
            <div class="text-xs">
              <SidePanel.Card>
                <For each={events()}>
                  {(event) => <ActivityRow event={event} />}
                </For>
              </SidePanel.Card>
            </div>
          </Show>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}

function ActivityRow(props: { event: ActivityEvent }) {
  return (
    <div class="flex min-h-7 min-w-0 items-center gap-2 px-2 py-1">
      <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5">
        <span class="font-medium text-ink">
          <ActorName actorId={props.event.actorId} />
        </span>
        <span class="min-w-0 text-ink-muted">
          <ActionPhrase event={props.event} />
        </span>
      </span>
      <span class="ml-auto shrink-0 text-ink-extra-muted">
        {formatRelativeTimestamp(new Date(props.event.occurredAt), {
          condensed: true,
        })}
      </span>
    </div>
  );
}
