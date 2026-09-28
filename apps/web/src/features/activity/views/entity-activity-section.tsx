import { SidePanel } from '@components/app/side-panel/SidePanel';
import CaretUpDownIcon from '@phosphor/caret-up-down.svg';
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
import { ActivityTimelineRow } from '../components/activity-timeline-row';
import { useActivityContext } from '../context/activity-context';
import {
  collapseRuns,
  entryAction,
  entryHead,
  type FeedEntry,
} from '../core/collapse-runs';
import type { ActivityEvent } from '../core/event';
import type { RailEnds } from '../core/feed-rows';
import { foldPanel } from '../core/fold-panel';
import { createActorName } from '../primitives/actor-name';
import { createEntityActivityState } from '../primitives/entity-activity';
import { useEntityActivityFlag } from '../use-entity-activity-flag';

/** Newest entries shown before the section folds behind its toggle. */
const PANEL_HEAD_LIMIT = 3;

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

/**
 * Newest entries first, folded to `PANEL_HEAD_LIMIT` lines plus the oldest
 * fetched entry pinned last so the line that started the history stays in
 * view. The rail runs from the first glyph to the last, through the toggle.
 */
function ReadyActivityList(props: { events: ActivityEvent[] }) {
  const [expanded, setExpanded] = createSignal(false);
  const entries = createMemo(() => collapseRuns(props.events));
  const fold = createMemo(() => foldPanel(entries(), PANEL_HEAD_LIMIT));
  const folded = () => fold().tail !== undefined;
  const visible = () => (expanded() ? entries() : fold().head);

  return (
    <div class="flex flex-col" data-activity-panel>
      <For each={visible()}>
        {(entry, index) => (
          <PanelRow
            entry={entry}
            rail={{
              above: index() > 0,
              below: index() < visible().length - 1 || folded(),
            }}
          />
        )}
      </For>
      <Show when={folded()}>
        <FoldToggle
          expanded={expanded()}
          onToggle={() => setExpanded((current) => !current)}
        />
        <Show when={!expanded() ? fold().tail : undefined}>
          {(tail) => (
            <PanelRow entry={tail()} rail={{ above: true, below: false }} />
          )}
        </Show>
      </Show>
    </div>
  );
}

function PanelRow(props: { entry: FeedEntry; rail: RailEnds }) {
  const context = useActivityContext();
  const name = createActorName(context, () => entryHead(props.entry).actorId);
  const definition = context.propertyDefinition(() => {
    const action = entryAction(props.entry);
    return action.kind === 'property-changed' ? action.property : undefined;
  });
  return (
    <ActivityTimelineRow
      entry={props.entry}
      actorName={name()}
      propertyDefinition={definition()}
      rail={props.rail}
      compact
    />
  );
}

/**
 * The fold row sits in the rail like a compact entry, with dotted connectors
 * in place of the line. Expanded, it is the last row, so nothing runs below.
 */
function FoldToggle(props: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={props.expanded}
      class="flex w-full items-stretch gap-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      data-activity-fold-toggle
      onClick={() => props.onToggle()}
    >
      <span class="flex w-3.5 shrink-0 flex-col items-center">
        <span
          aria-hidden
          class="mb-[3px] flex-1 border-edge-muted border-l border-dotted"
          data-activity-rail="above"
        />
        <CaretUpDownIcon class="size-3.5 shrink-0 text-ink-muted" />
        <span
          aria-hidden
          class={cn(
            'mt-[3px] flex-1 border-edge-muted border-l border-dotted',
            props.expanded && 'invisible'
          )}
          data-activity-rail="below"
        />
      </span>
      <span class="flex min-h-8 min-w-0 flex-1 items-center rounded-lg px-1 text-ink hover:bg-hover/30">
        {props.expanded ? 'Show less' : 'View all activities'}
      </span>
    </button>
  );
}
