import { analytics } from '@app/lib/analytics';
import { Telemetry } from '@macro-inc/observability';
import type { RoutineSuggestion } from '@service-scheduled-action/generated/schemas';
import { createSignal } from 'solid-js';
import type { ScheduleDraft } from '../../routines/core/draft';
import type { RoutineTarget } from '../../routines/core/routine-target';
import {
  newRoutineDraft,
  type RoutineTemplate,
} from '../../routines/core/routine-templates';
import {
  type RequestSuggestion,
  type StarterSuggestion,
  starterSuggestionDraft,
  type WorkspaceNames,
} from '../core/suggestion-draft';

/** What accepting and dismissing need from the app. */
export type SuggestionCapabilities = {
  catalog(): readonly RoutineTemplate[];
  defaultModel(): string;
  codeSteps(): boolean;
  workspace(): WorkspaceNames;
  /** Provision the person's personal tags so a tagging routine can add them. */
  ensurePersonalTags(): Promise<void>;
  /** Draft a routine from a request; a string says why it couldn't. */
  draft(request: string): Promise<ScheduleDraft | string>;
  /** Open the new routine's page, started from `draft`, to review it. */
  review(draft: ScheduleDraft): void;
  /** Open New routine with the request filled in, after drafting failed. */
  describe(request: string): void;
  /** Not interested; restores the suggestion and says so if it fails. */
  dismiss(id: string): void;
  notify(message: string): void;
};

export type SuggestionActions = {
  /** Open the suggestion's routine for review; nothing is saved yet. */
  review(suggestion: RoutineSuggestion): Promise<void>;
  /** Not interested: never suggested again. */
  dismiss(suggestion: RoutineSuggestion): void;
  /** The suggestion being drafted or opened. */
  pending(): string | undefined;
};

function catalogKey(suggestion: RoutineSuggestion) {
  return suggestion.kind === 'starter' ? suggestion.key : undefined;
}

function track(
  event: 'routine_suggestion_reviewed' | 'routine_suggestion_dismissed',
  suggestion: RoutineSuggestion
) {
  analytics.track(event, {
    suggestionId: suggestion.id,
    surface: suggestion.surface,
    kind: suggestion.kind,
    catalogKey: catalogKey(suggestion),
  });
}

/**
 * Accepting a suggestion always opens it for review before anything is
 * saved: a catalog routine with AI's knob values, or a request the
 * drafter writes first.
 */
export function createSuggestionActions(
  capabilities: SuggestionCapabilities
): SuggestionActions {
  const [pending, setPending] = createSignal<string>();

  async function reviewStarter(suggestion: StarterSuggestion) {
    const entry = capabilities
      .catalog()
      .find((routine) => routine.key === suggestion.key);
    if (!entry) {
      capabilities.notify('This routine isn’t available any more.');
      return;
    }
    const named = Object.values(entry.namedKnobs ?? {});
    if (named.includes('tag')) await capabilities.ensurePersonalTags();
    const base = newRoutineDraft(undefined, {
      defaultModel: capabilities.defaultModel(),
      codeSteps: capabilities.codeSteps(),
    });
    const { draft } = starterSuggestionDraft(suggestion, entry, base, {
      target: {
        kind: 'model',
        model: capabilities.defaultModel(),
      } satisfies RoutineTarget,
      codeSteps: capabilities.codeSteps(),
      workspace: capabilities.workspace(),
    });
    capabilities.review(draft);
  }

  async function reviewRequest(suggestion: RequestSuggestion) {
    const drafted = await capabilities.draft(suggestion.request);
    if (typeof drafted === 'string') {
      capabilities.notify(drafted);
      capabilities.describe(suggestion.request);
      return;
    }
    capabilities.review({
      ...drafted,
      name: drafted.name || suggestion.title,
      description: suggestion.request,
      suggestionId: suggestion.id,
    });
  }

  return {
    pending,
    async review(suggestion) {
      if (pending()) return;
      setPending(suggestion.id);
      track('routine_suggestion_reviewed', suggestion);
      try {
        // One trace from the click through drafting to the review opening;
        // only ids and kinds, never the request or knob values.
        await Telemetry.span('routine.suggestion.review', async (span) => {
          span.setAttr('routine.suggestion.id', suggestion.id);
          span.setAttr('routine.suggestion.kind', suggestion.kind);
          span.setAttr('routine.suggestion.surface', suggestion.surface);
          const key = catalogKey(suggestion);
          if (key) span.setAttr('routine.suggestion.catalog_key', key);
          if (suggestion.kind === 'starter') await reviewStarter(suggestion);
          else await reviewRequest(suggestion);
        });
      } finally {
        setPending(undefined);
      }
    },
    dismiss(suggestion) {
      track('routine_suggestion_dismissed', suggestion);
      capabilities.dismiss(suggestion.id);
    },
  };
}
