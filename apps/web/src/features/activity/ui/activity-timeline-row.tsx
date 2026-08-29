import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Show } from 'solid-js';
import { describeActionForEntity } from '../domain/describe-action';
import type { ActivityEvent } from '../domain/event';
import { toPropertyEntityType } from '../domain/event';
import { ActionGlyph } from './action-glyph';
import { ActionPhrase } from './action-phrase';
import { ActorName } from './actor-name';
import { EntityMention } from './entity-mention';
import { PropertyChangeText } from './property-change';

function Timestamp(props: { event: ActivityEvent }) {
  return (
    <time
      class="ml-auto shrink-0 text-right font-medium text-ink-extra-muted text-xs"
      dateTime={props.event.occurredAt}
    >
      {formatRelativeTimestamp(new Date(props.event.occurredAt), {
        condensed: true,
      })}
    </time>
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/**
 * Shared glyph-rail activity row used by the activity feed and AI activity
 * results. Entity references, property definitions, and option/tag values all
 * flow through the same resolvers regardless of where the row is rendered.
 */
export function ActivityTimelineRow(props: {
  event: ActivityEvent;
  actorName?: string;
  /** Activity feeds name the actor; caller-scoped tool results can omit it. */
  showActor?: boolean;
}) {
  const entityType = () => toPropertyEntityType(props.event.entityType);
  const showActor = () => props.showActor !== false;
  const actorName = () => props.actorName ?? '';

  return (
    <div
      class="mx-1 flex w-[calc(100%-0.5rem)] items-stretch gap-1 px-2 text-sm"
      data-activity-row
      data-activity-action={props.event.action.kind}
    >
      <div class="relative flex w-6 shrink-0 items-center justify-center">
        <div class="absolute inset-y-0 w-px bg-edge-muted" />
        <span class="relative flex size-5 items-center justify-center rounded-full bg-surface ring ring-edge-muted">
          <ActionGlyph
            action={props.event.action}
            class="size-3 text-ink-muted"
          />
        </span>
      </div>
      <Show
        when={entityType()}
        fallback={
          <div class={ROW_BODY_CLASS}>
            <Show when={showActor()}>
              <span class="shrink-0 font-medium">
                <ActorName name={actorName()} />
              </span>
            </Show>
            <span class="min-w-0 truncate text-ink-muted">
              <ActionPhrase event={props.event} capitalize={!showActor()} />
            </span>
            <Timestamp event={props.event} />
          </div>
        }
      >
        {(type) => (
          <EntityRow
            event={props.event}
            entityType={type()}
            showActor={showActor()}
            actorName={actorName()}
          />
        )}
      </Show>
    </div>
  );
}

const ROW_BODY_CLASS =
  'flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-hover/30';

function EntityRow(props: {
  event: ActivityEvent;
  entityType: EntityType;
  showActor: boolean;
  actorName: string;
}) {
  const parts = () => describeActionForEntity(props.event.action);
  const display = usePropertyEntityDisplay(
    () => props.event.entityId,
    () => props.entityType
  );
  const navHandlers = useSplitNavigationHandler<HTMLDivElement>((event) => {
    const block = display.blockOrFileType();
    if (!block) return;
    openDocument(
      block,
      props.event.entityId,
      display.linkParams(),
      event.shiftKey
    );
  });

  return (
    <div {...navHandlers} class={ROW_BODY_CLASS}>
      <Show when={props.showActor}>
        <span class="shrink-0 font-medium">
          <ActorName name={props.actorName} />
        </span>
      </Show>
      <span class="min-w-0 text-ink-muted">
        <Show
          when={
            props.event.action.kind === 'property-changed'
              ? props.event.action
              : undefined
          }
          fallback={props.showActor ? parts().verb : capitalize(parts().verb)}
        >
          {(change) => (
            <PropertyChangeText
              action={change()}
              capitalize={!props.showActor}
            />
          )}
        </Show>
      </span>
      <Show when={parts().connector}>
        {(connector) => (
          <span class="shrink-0 text-ink-muted">{connector()}</span>
        )}
      </Show>
      <span class="min-w-0 truncate">
        <EntityMention entityId={props.event.entityId} display={display} />
      </span>
      <Timestamp event={props.event} />
    </div>
  );
}
