import { SidePanel } from '@components/app/side-panel/SidePanel';
import CaretUpDownIcon from '@phosphor/caret-up-down.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
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
 * view. The rail is trimmed to the glyph centers at both ends.
 */
function ReadyActivityList(props: { events: ActivityEvent[] }) {
  const [expanded, setExpanded] = createSignal(false);
  const entries = createMemo(() => collapseRuns(props.events));
  const fold = createMemo(() => foldPanel(entries(), PANEL_HEAD_LIMIT));
  const folded = () => fold().tail !== undefined;
  const visible = () => (expanded() ? entries() : fold().head);

  return (
    <div
      class="flex flex-col [&>:first-child_[data-activity-rail]]:top-1/2 [&>:last-child_[data-activity-rail]]:bottom-1/2"
      data-activity-panel
    >
      <For each={visible()}>{(entry) => <PanelRow entry={entry} />}</For>
      <Show when={folded()}>
        <FoldToggle
          expanded={expanded()}
          onToggle={() => setExpanded((current) => !current)}
        />
        <Show when={!expanded() ? fold().tail : undefined}>
          {(tail) => <PanelRow entry={tail()} />}
        </Show>
      </Show>
    </div>
  );
}

function PanelRow(props: { entry: FeedEntry }) {
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
      compact
    />
  );
}

/** The fold row sits in the rail with a dotted connector in place of the line. */
function FoldToggle(props: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={props.expanded}
      class="flex w-full items-stretch gap-1 text-left text-ink-muted text-xs hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      data-activity-fold-toggle
      onClick={() => props.onToggle()}
    >
      <span class="relative flex w-5 shrink-0 items-center justify-center">
        <span
          class="absolute inset-y-0 border-edge-muted border-l border-dotted"
          data-activity-rail
        />
        <span class="relative flex size-4 items-center justify-center rounded-full bg-surface ring ring-edge-muted">
          <CaretUpDownIcon class="size-2.5" />
        </span>
      </span>
      <span class="flex min-h-7 min-w-0 flex-1 items-center rounded-lg px-1.5 py-0.5 hover:bg-hover/30">
        {props.expanded ? 'Show less' : 'View all activities'}
      </span>
    </button>
  );
}
