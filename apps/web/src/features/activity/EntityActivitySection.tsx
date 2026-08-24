import { SidePanel } from '@components/app/side-panel/SidePanel';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import CaretRightIcon from '@phosphor/caret-right.svg';
import {
  type ActivityEvent,
  createEntityActivityQuery,
} from '@queries/activity/graphql/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn } from '@ui';
import { createSignal, For, Show, Suspense } from 'solid-js';
import { ActionPhrase } from './action-phrase';
import { ActorName } from './actor-name';
import { useEntityActivityFlag } from './use-entity-activity-flag';

/** Rows shown before the section collapses behind a "Show all" toggle. */
const COLLAPSED_ROW_LIMIT = 10;

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

  // Collapsed to the newest rows, expandable like the History pane's
  // "Show activity" toggle, so a busy entity doesn't swallow the side panel.
  const [expanded, setExpanded] = createSignal(false);
  const visibleEvents = () =>
    expanded() ? events() : events().slice(0, COLLAPSED_ROW_LIMIT);
  const hasOverflow = () => events().length > COLLAPSED_ROW_LIMIT;

  return (
    <Show when={query.isEnabled()}>
      <SidePanel.Section id="activity" title="Activity" order={props.order}>
        {/* Two loading layers: the urql store never suspends, so the query's
            own fetch/error need explicit branches (or they'd render as a
            false "No activity yet"), while the Suspense boundary scopes
            resource reads inside the rows (display names, property
            definitions) to this section instead of an ancestor boundary. */}
        <Suspense fallback={<SidePanel.Loading />}>
          <Show when={!query.result.isLoading} fallback={<SidePanel.Loading />}>
            <Show
              when={!query.result.isError}
              fallback={<SidePanel.EmptyPill label="Activity is unavailable" />}
            >
              <Show
                when={events().length > 0}
                fallback={<SidePanel.EmptyPill label="No activity yet" />}
              >
                <div class="text-xs">
                  <SidePanel.Card>
                    <For each={visibleEvents()}>
                      {(event) => <ActivityRow event={event} />}
                    </For>
                  </SidePanel.Card>
                  <Show when={hasOverflow()}>
                    <button
                      type="button"
                      aria-expanded={expanded()}
                      class="mt-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-ink-muted text-xs hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      onClick={() => setExpanded((current) => !current)}
                    >
                      <CaretRightIcon
                        class={cn(
                          'size-3 shrink-0 transition-transform duration-90',
                          expanded() && 'rotate-90'
                        )}
                      />
                      <span>
                        {expanded()
                          ? 'Show less'
                          : `Show all (${events().length})`}
                      </span>
                    </button>
                  </Show>
                </div>
              </Show>
            </Show>
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
