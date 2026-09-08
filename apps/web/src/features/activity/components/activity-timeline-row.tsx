import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import type { PropertyDefinitionDomain } from '@property/types';
import { type JSX, Show } from 'solid-js';
import type { EntityDisplay } from '../context/activity-context';
import { describeActionForEntity } from '../core/describe-action';
import type { ActivityEvent } from '../core/event';
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
 * Glyph-rail activity row. Mentions and click-to-open handlers are passed
 * in already resolved so this leaf stays presentational.
 */
export function ActivityTimelineRow(props: {
  event: ActivityEvent;
  actorName?: string;
  showActor?: boolean;
  display?: EntityDisplay;
  propertyDefinition?: PropertyDefinitionDomain;
  rowProps?: JSX.HTMLAttributes<HTMLDivElement>;
}) {
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
        when={props.display}
        fallback={
          <RowBody>
            <Show when={showActor()}>
              <span class="shrink-0 font-medium">
                <ActorName name={actorName()} />
              </span>
            </Show>
            <span class="min-w-0 truncate text-ink-muted">
              <ActionPhrase
                event={props.event}
                propertyDefinition={props.propertyDefinition}
                capitalize={!showActor()}
              />
            </span>
            <Timestamp event={props.event} />
          </RowBody>
        }
      >
        {(display) => (
          <EntityRow
            event={props.event}
            display={display()}
            showActor={showActor()}
            actorName={actorName()}
            propertyDefinition={props.propertyDefinition}
            rowProps={props.rowProps}
          />
        )}
      </Show>
    </div>
  );
}

function RowBody(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      class="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-hover/30"
    />
  );
}

function EntityRow(props: {
  event: ActivityEvent;
  display: EntityDisplay;
  showActor: boolean;
  actorName: string;
  propertyDefinition?: PropertyDefinitionDomain;
  rowProps?: JSX.HTMLAttributes<HTMLDivElement>;
}) {
  const parts = () => describeActionForEntity(props.event.action);

  return (
    <RowBody {...props.rowProps}>
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
              definition={props.propertyDefinition}
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
        <EntityMention
          entityId={props.event.entityId}
          display={props.display}
        />
      </span>
      <Timestamp event={props.event} />
    </RowBody>
  );
}
