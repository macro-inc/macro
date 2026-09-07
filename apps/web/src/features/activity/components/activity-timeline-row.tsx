import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import type { PropertyDefinitionDomain } from '@property/types';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { EntityDisplay } from '../context/activity-context';
import { entryHead, entrySize, type FeedEntry } from '../core/collapse-runs';
import { describeActionForEntity, describeRun } from '../core/describe-action';
import { ActionGlyph } from './action-glyph';
import { ActionPhrase } from './action-phrase';
import { ActorName } from './actor-name';
import { EntityMention } from './entity-mention';
import { PropertyChangeText } from './property-change';

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function Separator() {
  return (
    <span aria-hidden class="shrink-0 text-ink-extra-muted">
      ·
    </span>
  );
}

// Feed rows sit in the `@container/u-list` shell. Under `@max-md` the body
// wraps onto a second line instead of truncating the entity name. Hosts
// outside that container (the side panel, the chat tool) never match.
const BODY_NARROW_CLASS = '@max-md/u-list:flex-wrap @max-md/u-list:py-1';
const TEXT_NARROW_CLASS = '@max-md/u-list:whitespace-normal';

/**
 * Glyph-rail activity line for a single event or a collapsed run. Reads
 * "<actor> <verb> [connector] <entity> [count] · <time>" with the timestamp
 * inline. Mentions and click-to-open handlers arrive already resolved so
 * this leaf stays presentational. `compact` is the side panel's density.
 */
export function ActivityTimelineRow(props: {
  entry: FeedEntry;
  actorName?: string;
  showActor?: boolean;
  compact?: boolean;
  display?: EntityDisplay;
  propertyDefinition?: PropertyDefinitionDomain;
  rowProps?: JSX.HTMLAttributes<HTMLDivElement>;
}) {
  const showActor = () => props.showActor !== false;
  const actorName = () => props.actorName ?? '';
  const head = () => entryHead(props.entry);
  const described = () => describeRun(props.entry);
  const action = () => described().action;
  const parts = () => describeActionForEntity(action());
  const propertyChange = () => {
    const current = action();
    return current.kind === 'property-changed' ? current : undefined;
  };

  return (
    <div
      class={cn(
        'flex items-stretch gap-1',
        props.compact ? 'text-xs' : 'mx-1 w-[calc(100%-0.5rem)] px-2 text-sm'
      )}
      data-activity-row
      data-activity-action={action().kind}
      data-activity-run-size={entrySize(props.entry)}
    >
      <div
        class={cn(
          'relative flex shrink-0 items-center justify-center',
          props.compact ? 'w-5' : 'w-6'
        )}
      >
        <div class="absolute inset-y-0 w-px bg-edge-muted" data-activity-rail />
        <span
          class={cn(
            'relative flex items-center justify-center rounded-full bg-surface ring ring-edge-muted',
            props.compact ? 'size-4' : 'size-5'
          )}
        >
          <ActionGlyph
            action={action()}
            class={cn('text-ink-muted', props.compact ? 'size-2.5' : 'size-3')}
          />
        </span>
      </div>
      <div
        {...props.rowProps}
        class={cn(
          'flex min-w-0 flex-1 items-center rounded-lg py-0.5 hover:bg-hover/30',
          BODY_NARROW_CLASS,
          props.compact
            ? 'min-h-7 gap-1 px-1.5'
            : 'min-h-10 gap-1.5 px-2 touch:min-h-11'
        )}
      >
        <Show when={showActor()}>
          <span class="shrink-0 font-medium">
            <ActorName name={actorName()} />
          </span>
        </Show>
        <Show
          when={props.display}
          fallback={
            <span
              class={cn('min-w-0 truncate text-ink-muted', TEXT_NARROW_CLASS)}
            >
              <ActionPhrase
                action={action()}
                propertyDefinition={props.propertyDefinition}
                capitalize={!showActor()}
              />
            </span>
          }
        >
          {(display) => (
            <>
              <span class="min-w-0 text-ink-muted">
                <Show
                  when={propertyChange()}
                  fallback={
                    showActor() ? parts().verb : capitalize(parts().verb)
                  }
                >
                  {(change) => (
                    <PropertyChangeText
                      action={change()}
                      definition={props.propertyDefinition}
                      capitalize={!showActor()}
                    />
                  )}
                </Show>
              </span>
              <Show when={parts().connector}>
                {(connector) => (
                  <span class="shrink-0 text-ink-muted">{connector()}</span>
                )}
              </Show>
              <span class={cn('min-w-0 truncate', TEXT_NARROW_CLASS)}>
                <EntityMention entityId={head().entityId} display={display()} />
              </span>
            </>
          )}
        </Show>
        <Show when={described().countLabel}>
          {(label) => (
            <>
              <Show when={propertyChange()}>
                <Separator />
              </Show>
              <span class="shrink-0 text-ink-muted">{label()}</span>
            </>
          )}
        </Show>
        <Separator />
        <time
          class="shrink-0 text-ink-extra-muted"
          dateTime={head().occurredAt}
        >
          {formatRelativeTimestamp(new Date(head().occurredAt), {
            condensed: true,
          })}
        </time>
      </div>
    </div>
  );
}
