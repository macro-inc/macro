import type { ScheduleDraft } from '@app/features/routines/core/draft';
import { getErrorMessage } from '@app/features/routines/core/routine-draft';
import type { RoutineTarget } from '@app/features/routines/core/routine-target';
import { type Accessor, createSignal } from 'solid-js';
import {
  type RoutineSuggestion,
  type SuggestionEdits,
  type SuggestionStatus,
  suggestionToDraft,
} from '../core/suggestions';

export type SuggestionActionsDeps = {
  /** The model or agent new routines run with. */
  target: Accessor<RoutineTarget>;
  /** Existing routines, so suggestions the user already has read as enabled. */
  existingRoutines: Accessor<{ id: string; name: string }[]>;
  create(draft: ScheduleDraft): Promise<string>;
  /** Opens the full routine editor, prefilled, where the host has one. */
  customize?: (draft: ScheduleDraft) => void;
};

/**
 * Per-suggestion state for a list of suggestions: what the user edited,
 * which row is open, and whether enabling is running, done, or failed.
 * Enabling twice never creates two routines.
 */
export function createSuggestionActions(deps: SuggestionActionsDeps) {
  const [edits, setEdits] = createSignal<Record<string, SuggestionEdits>>({});
  const [statuses, setStatuses] = createSignal<
    Record<string, SuggestionStatus>
  >({});
  const [expandedId, setExpandedId] = createSignal<string>();

  const setStatus = (id: string, status: SuggestionStatus) =>
    setStatuses((previous) => ({ ...previous, [id]: status }));

  const editsFor = (suggestion: RoutineSuggestion): SuggestionEdits =>
    edits()[suggestion.id] ?? {
      title: suggestion.title,
      instructions: suggestion.instructions,
      notify: suggestion.notify,
    };

  const statusFor = (suggestion: RoutineSuggestion): SuggestionStatus => {
    const own = statuses()[suggestion.id];
    if (own && own.kind !== 'idle') return own;
    const name = editsFor(suggestion).title.trim().toLowerCase();
    const existing = deps
      .existingRoutines()
      .find((routine) => routine.name.trim().toLowerCase() === name);
    return existing
      ? { kind: 'enabled', routineId: existing.id }
      : { kind: 'idle' };
  };

  const draftFor = (suggestion: RoutineSuggestion) => {
    const edited = editsFor(suggestion);
    return suggestionToDraft(
      {
        title: edited.title.trim() || suggestion.title,
        instructions: edited.instructions.trim() || suggestion.instructions,
        notify: edited.notify,
        trigger: suggestion.trigger,
      },
      deps.target()
    );
  };

  async function enable(suggestion: RoutineSuggestion) {
    const current = statusFor(suggestion).kind;
    if (current === 'enabling' || current === 'enabled') return;
    setStatus(suggestion.id, { kind: 'enabling' });
    try {
      const routineId = await deps.create(draftFor(suggestion));
      setStatus(suggestion.id, { kind: 'enabled', routineId });
    } catch (error) {
      setStatus(suggestion.id, {
        kind: 'failed',
        message: `Couldn't enable this routine. ${getErrorMessage(error)}`,
      });
    }
  }

  return {
    editsFor,
    statusFor,
    isExpanded: (suggestion: RoutineSuggestion) =>
      expandedId() === suggestion.id,
    setExpanded: (suggestion: RoutineSuggestion, expanded: boolean) =>
      setExpandedId(expanded ? suggestion.id : undefined),
    edit: (suggestion: RoutineSuggestion, next: SuggestionEdits) => {
      setEdits((previous) => ({ ...previous, [suggestion.id]: next }));
      if (statuses()[suggestion.id]?.kind === 'failed')
        setStatus(suggestion.id, { kind: 'idle' });
    },
    enable,
    customize: (suggestion: RoutineSuggestion) =>
      deps.customize?.(draftFor(suggestion)),
  };
}

export type SuggestionActions = ReturnType<typeof createSuggestionActions>;
