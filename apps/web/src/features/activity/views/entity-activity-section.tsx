import { SidePanel } from '@components/app/side-panel/SidePanel';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import CaretRightIcon from '@phosphor/caret-right.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { createEntityActivityQuery } from '../adapters/entity-query';
import type { ActivityEvent } from '../domain/event';
import { ActionPhrase } from '../ui/action-phrase';
import { ActorName } from '../ui/actor-name';
import { useEntityActivityFlag } from '../use-entity-activity-flag';
import { useActorDisplayName } from './resolve-actor-name';

/** Rows shown before the section collapses behind a "Show all" toggle. */
const COLLAPSED_ROW_LIMIT = 10;

type EntityActivityView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'empty' }
  | { t: 'ready'; events: ActivityEvent[] };

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
  const view = createMemo<EntityActivityView>(() => {
    if (query.result.isLoading) return { t: 'loading' };
    if (query.result.isError) return { t: 'error' };
    const data = query.result.data;
    if (!data || data.kind === 'entity-missing') return { t: 'error' };
    if (data.events.length === 0) return { t: 'empty' };
    return { t: 'ready', events: data.events };
  });

  return (
    <Show when={query.isEnabled()}>
      <SidePanel.Section id="activity" title="Activity" order={props.order}>
        <Suspense fallback={<SidePanel.Loading />}>
          <Switch>
            <Match when={view().t === 'loading'}>
              <SidePanel.Loading />
            </Match>
            <Match when={view().t === 'error'}>
              <SidePanel.EmptyPill label="Activity is unavailable" />
            </Match>
            <Match when={view().t === 'empty'}>
              <SidePanel.EmptyPill label="No activity yet" />
            </Match>
            <Match
              when={(() => {
                const current = view();
                return current.t === 'ready' ? current : undefined;
              })()}
            >
              {(ready) => <ReadyActivityList events={ready().events} />}
            </Match>
          </Switch>
        </Suspense>
      </SidePanel.Section>
    </Show>
  );
}

function ReadyActivityList(props: { events: ActivityEvent[] }) {
  const [expanded, setExpanded] = createSignal(false);
  const visibleEvents = () =>
    expanded() ? props.events : props.events.slice(0, COLLAPSED_ROW_LIMIT);
  const hasOverflow = () => props.events.length > COLLAPSED_ROW_LIMIT;

  return (
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
            {expanded() ? 'Show less' : `Show all (${props.events.length})`}
          </span>
        </button>
      </Show>
    </div>
  );
}

function ActivityRow(props: { event: ActivityEvent }) {
  const name = useActorDisplayName(() => props.event.actorId);
  return (
    <div
      class="flex min-h-7 min-w-0 items-center gap-2 px-2 py-1"
      data-activity-row
      data-activity-action={props.event.action.kind}
    >
      <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5">
        <span class="font-medium text-ink">
          <ActorName name={name()} />
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
