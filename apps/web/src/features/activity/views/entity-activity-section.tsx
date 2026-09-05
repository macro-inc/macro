import { SidePanel } from '@components/app/side-panel/SidePanel';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import CaretRightIcon from '@phosphor/caret-right.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn } from '@ui';
import { createSignal, For, Match, Show, Suspense, Switch } from 'solid-js';
import { ActionPhrase } from '../components/action-phrase';
import { ActorName } from '../components/actor-name';
import { useActivityContext } from '../context/activity-context';
import type { ActivityEvent } from '../core/event';
import { createActorName } from '../primitives/actor-name';
import { createEntityActivityState } from '../primitives/entity-activity';
import { useEntityActivityFlag } from '../use-entity-activity-flag';

/** Rows shown before the section collapses behind a "Show all" toggle. */
const COLLAPSED_ROW_LIMIT = 10;

export interface EntityActivitySectionProps {
  entityId: string;
  entityType: EntityType;
  order?: number;
}

/**
 * The side-panel Activity section behind its flag. Nothing mounts (and no
 * query is issued) while the rollout is off.
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

/** The section itself. Reads `ActivityContext`. */
export function EntityActivitySection(props: EntityActivitySectionProps) {
  const context = useActivityContext();
  const state = createEntityActivityState(context, {
    entityType: () => props.entityType,
    entityId: () => props.entityId,
  });
  const ready = () => {
    const current = state.view();
    return current.t === 'ready' ? current : undefined;
  };

  return (
    <Show when={state.isEnabled()}>
      <SidePanel.Section id="activity" title="Activity" order={props.order}>
        <Suspense fallback={<SidePanel.Loading />}>
          <Switch>
            <Match when={state.view().t === 'loading'}>
              <SidePanel.Loading />
            </Match>
            <Match when={state.view().t === 'error'}>
              <SidePanel.EmptyPill label="Activity is unavailable" />
            </Match>
            <Match when={state.view().t === 'empty'}>
              <SidePanel.EmptyPill label="No activity yet" />
            </Match>
            <Match when={ready()}>
              {(current) => <ReadyActivityList events={current().events} />}
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
  const context = useActivityContext();
  const name = createActorName(context, () => props.event.actorId);
  const definition = context.propertyDefinition(() => {
    const action = props.event.action;
    return action.kind === 'property-changed' ? action.property : undefined;
  });
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
          <ActionPhrase event={props.event} propertyDefinition={definition()} />
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
