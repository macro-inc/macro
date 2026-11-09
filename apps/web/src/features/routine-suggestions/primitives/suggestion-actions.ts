import { analytics } from '@app/lib/analytics';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal } from 'solid-js';
import type { ScheduleDraft } from '../../routines/core/draft';
import { getErrorMessage } from '../../routines/core/routine-draft';
import {
  draftWithEdits,
  type EnabledRow,
  initialEdits,
  type SuggestionEdits,
  type SuggestionItem,
  type SuggestionStatus,
  withEnabledInPlace,
} from '../core/suggestions';
import type { RoutineSurface } from '../core/surfaces';

/** Where a list of suggestions is: a sidebar's dialog, or the Routines page. */
export type SuggestionPlacement =
  | { kind: 'sidebar'; surface: RoutineSurface }
  | { kind: 'routines' };

/** What enabling, editing and dismissing need from the app. */
export type SuggestionActionsDeps = {
  placement: Accessor<SuggestionPlacement>;
  /** Save the routine from the suggestion; resolves to the new routine's id. */
  create(draft: ScheduleDraft, item: SuggestionItem): Promise<string>;
  /** Open the full routine editor, prefilled; nothing is saved yet. */
  customize(draft: ScheduleDraft): void;
  /** Not interested, everywhere; rejects when the server refused. */
  dismiss(item: SuggestionItem): Promise<void>;
  /** Tell the person something went wrong outside a row. */
  notify(message: string): void;
};

type SuggestionEvent =
  | 'routine_suggestion_shown'
  | 'routine_suggestion_enabled'
  | 'routine_suggestion_edited'
  | 'routine_suggestion_customized'
  | 'routine_suggestion_dismissed';

/** The surface a suggestion counts for: the sidebar's, or its main one. */
function surfaceOf(item: SuggestionItem, placement: SuggestionPlacement) {
  return placement.kind === 'sidebar'
    ? placement.surface
    : (item.surfaces[0] ?? 'agents');
}

/**
 * Per-suggestion state for a list: what the person edited, which row is
 * open, and whether enabling is running, done or failed. Enabling twice never
 * creates two routines, and a row enabled here stays in place to open it.
 */
export function createSuggestionActions(deps: SuggestionActionsDeps) {
  const [edits, setEdits] = createSignal<Record<string, SuggestionEdits>>({});
  const [statuses, setStatuses] = createSignal<
    Record<string, SuggestionStatus>
  >({});
  const [expandedId, setExpandedId] = createSignal<string>();
  const [enabled, setEnabled] = createSignal<EnabledRow<SuggestionItem>[]>([]);
  // Plain sets: they only dedupe analytics, nothing renders from them.
  const shownIds = new Set<string>();
  const editedIds = new Set<string>();

  const eventProps = (item: SuggestionItem) => {
    const placement = deps.placement();
    return {
      suggestionId: item.id,
      surface: surfaceOf(item, placement),
      placement: placement.kind,
      from: item.from,
      kind: item.kind,
      catalogKey: item.catalogKey,
    };
  };
  const track = (event: SuggestionEvent, item: SuggestionItem, extra = {}) =>
    analytics.track(event, { ...eventProps(item), ...extra });
  const spanAttrs = (
    span: { setAttr(name: string, value: string): void },
    item: SuggestionItem
  ) => {
    const props = eventProps(item);
    span.setAttr('routine.suggestion.id', props.suggestionId);
    span.setAttr('routine.suggestion.surface', props.surface);
    span.setAttr('routine.suggestion.placement', props.placement);
    span.setAttr('routine.suggestion.from', props.from);
    span.setAttr('routine.suggestion.kind', props.kind);
    if (props.catalogKey)
      span.setAttr('routine.suggestion.catalog_key', props.catalogKey);
  };

  const setStatus = (id: string, status: SuggestionStatus) =>
    setStatuses((previous) => ({ ...previous, [id]: status }));

  const editsFor = (item: SuggestionItem): SuggestionEdits =>
    edits()[item.id] ?? initialEdits(item);

  const statusFor = (item: SuggestionItem): SuggestionStatus =>
    statuses()[item.id] ?? { kind: 'idle' };

  const draftFor = (item: SuggestionItem) =>
    draftWithEdits(item, editsFor(item));

  /** `above` lists the rows above it, so it stays there once the server drops it. */
  async function enable(item: SuggestionItem, above: readonly string[] = []) {
    const current = statusFor(item).kind;
    if (current === 'enabling' || current === 'enabled') return;
    setStatus(item.id, { kind: 'enabling' });
    const draft = draftFor(item);
    const wasEdited = editedIds.has(item.id);
    try {
      // One trace from the click to the saved routine; ids and kinds only.
      const routineId = await Telemetry.span(
        'routine_suggestion.enable',
        async (span) => {
          spanAttrs(span, item);
          span.setAttr('routine.suggestion.edited', wasEdited);
          return await deps.create(draft, item);
        }
      );
      setEnabled((previous) => [...previous, { item, above }]);
      setStatus(item.id, { kind: 'enabled', routineId });
      track('routine_suggestion_enabled', item, {
        routineId,
        edited: wasEdited,
      });
    } catch (error) {
      setStatus(item.id, {
        kind: 'failed',
        message: `Couldn't enable this routine. ${getErrorMessage(error)}`,
      });
    }
  }

  async function dismiss(item: SuggestionItem) {
    track('routine_suggestion_dismissed', item);
    try {
      await Telemetry.span('routine_suggestion.dismiss', async (span) => {
        spanAttrs(span, item);
        await deps.dismiss(item);
      });
    } catch {
      deps.notify('Couldn’t dismiss that suggestion. Try again.');
    }
  }

  return {
    editsFor,
    statusFor,
    /** The list with rows enabled here kept where they were. */
    visible: (items: readonly SuggestionItem[]) =>
      withEnabledInPlace(items, enabled()),
    /** Record that a row was on screen, once per list. */
    shown(item: SuggestionItem) {
      if (shownIds.has(item.id)) return;
      shownIds.add(item.id);
      track('routine_suggestion_shown', item);
    },
    isExpanded: (item: SuggestionItem) => expandedId() === item.id,
    setExpanded: (item: SuggestionItem, expanded: boolean) =>
      setExpandedId(expanded ? item.id : undefined),
    edit(item: SuggestionItem, next: SuggestionEdits) {
      setEdits((previous) => ({ ...previous, [item.id]: next }));
      if (!editedIds.has(item.id)) {
        editedIds.add(item.id);
        track('routine_suggestion_edited', item);
      }
      if (statuses()[item.id]?.kind === 'failed')
        setStatus(item.id, { kind: 'idle' });
    },
    enable,
    customize(item: SuggestionItem) {
      track('routine_suggestion_customized', item, {
        edited: editedIds.has(item.id),
      });
      deps.customize(draftFor(item));
    },
    dismiss,
  };
}

export type SuggestionActions = ReturnType<typeof createSuggestionActions>;
