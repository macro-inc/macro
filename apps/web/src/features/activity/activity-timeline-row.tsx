import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { GraphqlEntityType } from '@service-storage/graphql/generated/graphql';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ActionGlyph } from './action-glyph';
import { ActionPhrase } from './action-phrase';
import { ActorName } from './actor-name';
import {
  actionAsPropertyChange,
  describeActionForEntity,
} from './describe-action';
import { EntityMention } from './entity-mention';
import { PropertyChangeText } from './property-change';

/**
 * Maps an activity event's canonical entity type onto the display vocabulary
 * used by the shared entity name/icon/link resolver. Unsupported entity kinds
 * render without a reference instead of leaking a raw identifier.
 */
function displayEntityType(
  entityType: GraphqlEntityType
): EntityType | undefined {
  return match<GraphqlEntityType, EntityType | undefined>(entityType)
    .with('DOCUMENT', () => 'DOCUMENT')
    .with('PROJECT', () => 'PROJECT')
    .with('CHAT', () => 'CHAT')
    .with('EMAIL_THREAD', () => 'THREAD')
    .with('CHANNEL', () => 'CHANNEL')
    .with('USER', () => 'USER')
    .otherwise(() => undefined);
}

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
  /** Activity feeds name the actor; caller-scoped tool results can omit it. */
  showActor?: boolean;
}) {
  const entityType = () => displayEntityType(props.event.entityType);
  const showActor = () => props.showActor !== false;

  return (
    <div class="mx-1 flex w-[calc(100%-0.5rem)] items-stretch gap-1 px-2 text-sm">
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
                <ActorName actorId={props.event.actorId} />
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
          <ActorName actorId={props.event.actorId} />
        </span>
      </Show>
      <span class="min-w-0 text-ink-muted">
        <Show
          when={actionAsPropertyChange(props.event.action)}
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
