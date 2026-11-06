import type {
  CatalogEntry,
  RoutineSuggestion,
} from '@service-scheduled-action/generated/schemas';
import type { ScheduleDraft } from '../../routines/core/draft';
import {
  type Knob,
  sentenceText,
  withKnobValue,
} from '../../routines/core/knobs';
import {
  type StepDraft,
  stepsFromTask,
} from '../../routines/core/routine-steps';
import type { RoutineTarget } from '../../routines/core/routine-target';
import {
  type RoutineTemplate,
  templateChain,
  templateDraft,
} from '../../routines/core/routine-templates';

export type StarterSuggestion = Extract<RoutineSuggestion, { kind: 'starter' }>;
export type RequestSuggestion = Extract<RoutineSuggestion, { kind: 'request' }>;

/** What a knob's value names: one of the person's tags, channels or labels. */
export type NamedItemKind = 'tag' | 'channel' | 'label';

/** The person's items by name, to match the names AI wrote. */
export type WorkspaceNames = Record<NamedItemKind, readonly string[]>;

/** A knob naming an item the person doesn't have yet. */
export type MissingItem = { knob: string; kind: NamedItemKind; name: string };

export type SuggestionDraft = {
  draft: ScheduleDraft;
  /** Named items that don't exist; the review offers to make them. */
  missing: MissingItem[];
};

function fold(name: string) {
  return name.trim().toLocaleLowerCase();
}

/**
 * `value` as the person's own spelling of an item they have, or undefined
 * when they have none by that name.
 */
export function matchName(
  value: string,
  names: readonly string[]
): string | undefined {
  return names.find((name) => fold(name) === fold(value));
}

/** The catalog step's knobs with AI's values, and named items resolved. */
function suggestedKnobs(
  knobs: readonly Knob[],
  values: StarterSuggestion,
  named: CatalogEntry['namedKnobs'],
  workspace: WorkspaceNames,
  missing: MissingItem[]
): Knob[] {
  let result = [...knobs];
  for (const [name, value] of Object.entries(values.knobs)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result = withKnobValue(result, name, value);
    }
  }
  for (const knob of result) {
    const kind = named?.[knob.name];
    if (!kind || knob.type !== 'text') continue;
    const own = matchName(knob.value, workspace[kind]);
    if (own) result = withKnobValue(result, knob.name, own);
    else missing.push({ knob: knob.name, kind, name: knob.value });
  }
  return result;
}

/**
 * A new routine from a catalog suggestion, ready to review: the catalog
 * routine's trigger and steps, its knobs set as AI suggested with names
 * matched to the person's own items, and the suggestion it came from.
 */
export function starterSuggestionDraft(
  suggestion: StarterSuggestion,
  entry: RoutineTemplate,
  base: ScheduleDraft,
  context: {
    target: RoutineTarget;
    codeSteps: boolean;
    workspace: WorkspaceNames;
  }
): SuggestionDraft {
  const draft = templateDraft(entry, base, context);
  const missing: MissingItem[] = [];
  const steps = draft.steps?.map(
    (step): StepDraft =>
      step.kind === 'code'
        ? {
            ...step,
            knobs: suggestedKnobs(
              step.knobs,
              suggestion,
              entry.namedKnobs,
              context.workspace,
              missing
            ),
          }
        : step
  );
  // Its description says what it does with the values it starts with.
  const [code] = (steps ?? []).filter((step) => step.kind === 'code');
  const description =
    (code?.kind === 'code' && sentenceText(code.sentence, code.knobs)) ||
    draft.description;
  return {
    draft: {
      ...draft,
      ...(steps ? { steps } : {}),
      description,
      suggestionId: suggestion.id,
    },
    missing,
  };
}

/** What a suggestion's row says: its name, what it does and when. */
export type SuggestionSummary = {
  title: string;
  /** What it does, with AI's knob values filled in. */
  does: string;
  /** When it runs, for catalog routines. */
  when?: string;
};

export function suggestionSummary(
  suggestion: RoutineSuggestion,
  entry: RoutineTemplate | undefined
): SuggestionSummary | undefined {
  if (suggestion.kind === 'request') {
    return { title: suggestion.title, does: suggestion.request };
  }
  if (!entry) return undefined;
  const [step] = (entry.code && stepsFromTask({ steps: [entry.code] })) ?? [];
  let does: string | undefined;
  if (step?.kind === 'code') {
    let knobs = step.knobs;
    for (const [name, value] of Object.entries(suggestion.knobs)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        knobs = withKnobValue(knobs, name, value);
      }
    }
    does = sentenceText(step.sentence, knobs);
  }
  return {
    title: entry.title,
    does: does ?? entry.description,
    when: templateChain(entry).trigger || undefined,
  };
}
