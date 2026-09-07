import {
  formatCompactRelativeTimestamp,
  formatDateAndTime,
} from '@entity/utils/timestamp';
import type { PropertyDefinitionDomain } from '@property/types';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { EntityDisplay } from '../context/activity-context';
import { entryHead, entrySize, type FeedEntry } from '../core/collapse-runs';
import { describeActionForEntity, describeRun } from '../core/describe-action';
import type { RailEnds } from '../core/feed-rows';
import { ActionGlyph } from './action-glyph';
import { ActionPhrase } from './action-phrase';
import { ActorName } from './actor-name';
import { EntityMention } from './entity-mention';
import { PropertyChangeText } from './property-change';

const NO_RAIL: RailEnds = { above: false, below: false };

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

/**
 * Glyph-rail activity line for a single event or a collapsed run. Reads
 * "<actor> <verb> [connector] <entity> [count] · <time>" on one line; long
 * content truncates. The glyph is a plain icon; `rail` says which connector
 * segments run from it toward the neighbouring rows, so the rows read as one
 * line with a gap around each glyph. Mentions and click-to-open handlers
 * arrive already resolved so this leaf stays presentational. `compact` is
 * the side panel's density.
 */
export function ActivityTimelineRow(props: {
  entry: FeedEntry;
  actorName?: string;
  showActor?: boolean;
  compact?: boolean;
  rail?: RailEnds;
  display?: EntityDisplay;
  propertyDefinition?: PropertyDefinitionDomain;
  rowProps?: JSX.HTMLAttributes<HTMLDivElement>;
}) {
  const showActor = () => props.showActor !== false;
  const actorName = () => props.actorName ?? '';
  const rail = () => props.rail ?? NO_RAIL;
  const head = () => entryHead(props.entry);
  const described = () => describeRun(props.entry);
  const action = () => described().action;
  const parts = () => describeActionForEntity(action());
  const propertyChange = () => {
    const current = action();
    return current.kind === 'property-changed' ? current : undefined;
  };
  // Rows with a named entity, and property runs anywhere, take the count as
  // a suffix ("… 5 times", "… 3 changes"); a plain phrase without an entity
  // folds it in instead ("made 5 edits").
  const countSuffix = () =>
    props.display || propertyChange() ? described().countLabel : undefined;

  return (
    <div
      class={cn(
        'flex items-stretch',
        props.compact
          ? 'gap-1.5 text-xs'
          : 'mx-1 w-[calc(100%-0.5rem)] gap-2 px-2 text-sm'
      )}
      data-activity-row
      data-activity-action={action().kind}
      data-activity-run-size={entrySize(props.entry)}
    >
      <div
        class={cn(
          'flex shrink-0 flex-col items-center',
          props.compact ? 'w-3.5' : 'w-4'
        )}
      >
        <span
          aria-hidden
          class={cn(
            'mb-[3px] w-px flex-1 bg-edge-muted',
            !rail().above && 'invisible'
          )}
          data-activity-rail="above"
        />
        <ActionGlyph
          action={action()}
          class={cn(
            'shrink-0 text-ink-muted',
            props.compact ? 'size-3.5' : 'size-4'
          )}
        />
        <span
          aria-hidden
          class={cn(
            'mt-[3px] w-px flex-1 bg-edge-muted',
            !rail().below && 'invisible'
          )}
          data-activity-rail="below"
        />
      </div>
      <div
        {...props.rowProps}
        class={cn(
          'flex min-w-0 flex-1 items-center whitespace-nowrap rounded-lg hover:bg-hover/30',
          props.compact
            ? 'min-h-8 gap-1 px-1'
            : 'min-h-10 gap-1.5 px-2 touch:min-h-11'
        )}
      >
        <Show when={showActor()}>
          <span class="shrink-0 font-medium text-ink">
            <ActorName name={actorName()} />
          </span>
        </Show>
        {/* The sentence gives way in order: the entity name truncates to its
            icon, then the sentence clips at its right edge. The actor, the
            count and the time outside this box always stay. */}
        <span
          class={cn(
            'flex min-w-0 max-w-max flex-1 items-center overflow-hidden',
            props.compact ? 'gap-1' : 'gap-1.5'
          )}
        >
          <Show
            when={props.display}
            fallback={
              <span class="min-w-0 truncate text-ink-muted">
                <ActionPhrase
                  action={action()}
                  count={entrySize(props.entry)}
                  propertyDefinition={props.propertyDefinition}
                  capitalize={!showActor()}
                />
              </span>
            }
          >
            {(display) => (
              <>
                <span class="shrink-0 text-ink-muted">
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
                {/* Zero basis grown to its own content: the mention takes
                    only the room left, so a long name gives way first. */}
                <span class="min-w-[3ch] max-w-max flex-1 truncate">
                  <EntityMention
                    entityId={head().entityId}
                    display={display()}
                  />
                </span>
              </>
            )}
          </Show>
        </span>
        <Show when={countSuffix()}>
          {(label) => (
            <>
              <Show when={propertyChange()}>
                <Separator />
              </Show>
              <span class="shrink-0 text-ink-muted">{label()}</span>
            </>
          )}
        </Show>
        <span class="flex shrink-0 items-center gap-1 text-ink-extra-muted">
          <Separator />
          <time
            dateTime={head().occurredAt}
            title={formatDateAndTime(head().occurredAt)}
          >
            {formatCompactRelativeTimestamp(head().occurredAt)}
          </time>
        </span>
      </div>
    </div>
  );
}
