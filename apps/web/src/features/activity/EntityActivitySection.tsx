import { SidePanel } from '@components/app/side-panel/SidePanel';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId } from '@core/user';
import { DisplayName } from '@entity/components/DisplayName';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import {
  type ActivityEvent,
  createEntityActivityQuery,
} from '@queries/activity/graphql/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { For, Show, Suspense } from 'solid-js';
import { describeAction } from './describe-action';
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
            <SidePanel.Card>
              <For each={events()}>
                {(event) => <ActivityRow event={event} />}
              </For>
            </SidePanel.Card>
          </Show>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}

function ActivityRow(props: { event: ActivityEvent }) {
  const actorId = () => tryMacroId(props.event.actorId);

  return (
    <div class="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
      <Show when={actorId()}>
        {(id) => <UserIcon id={id()} size="sm" showTooltip={false} />}
      </Show>
      <span class="min-w-0 truncate">
        <Show when={actorId()} fallback={<span>Automation</span>}>
          {(id) => (
            <span class="font-medium">
              <DisplayName id={id()} format="firstName" />
            </span>
          )}
        </Show>{' '}
        <span class="text-text-secondary">
          {describeAction(props.event.action)}
        </span>
      </span>
      <span class="ml-auto shrink-0 text-xs text-text-secondary">
        {formatRelativeTimestamp(new Date(props.event.occurredAt), {
          condensed: true,
        })}
      </span>
    </div>
  );
}
