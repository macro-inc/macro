import type {
  ActionConfiguration,
  RoutineSuggestion,
  ScheduledAction,
  SuggestionFrom,
} from '@service-scheduled-action/generated/schemas';
import type { ScheduleDraft } from '../../routines/core/draft';
import {
  type Knob,
  sentenceText,
  withKnobValue,
} from '../../routines/core/knobs';
import type { StepDraft } from '../../routines/core/routine-steps';
import type { RoutineTarget } from '../../routines/core/routine-target';
import {
  type RoutineTemplate,
  templateChain,
  templateDraft,
} from '../../routines/core/routine-templates';
import { describeTrigger } from '../../routines/core/routine-triggers';
import { draftFromSchedule } from '../../routines/queries/routine-draft';
import type { RoutineSurface } from './surfaces';

export type CatalogPick = Extract<RoutineSuggestion, { kind: 'catalog' }>;
export type DraftedPick = Extract<RoutineSuggestion, { kind: 'routine' }>;

/** A suggestion as its row shows it, with the routine it saves. */
export type SuggestionItem = {
  id: string;
  from: SuggestionFrom;
  kind: RoutineSuggestion['kind'];
  /** The catalog routine it starts from, for catalog picks. */
  catalogKey?: string;
  /** The sidebars it shows in, first the one it belongs to most. */
  surfaces: RoutineSurface[];
  title: string;
  /** What it does, with AI's knob values filled in. */
  summary: string;
  /** When it runs, e.g. "When a new email arrives". */
  when: string;
  /** "For you · reason" for AI's picks, "Template from Macro" for Macro's. */
  byline: string;
  /** Saving it needs the person's own tags to exist first. */
  needsPersonalTags: boolean;
  /**
   * A drafted routine, which the person reviews in the composer before it's
   * saved; catalog picks can be enabled in one click.
   */
  reviewFirst: boolean;
  /** The routine it saves, switched on and pointing back at the suggestion. */
  draft: ScheduleDraft;
};

/** What the person may change before enabling it from its row. */
export type SuggestionEdits = {
  title: string;
  /** An Ask AI routine's instructions; absent where its steps are code. */
  instructions?: string;
  notify: boolean;
};

/** What the person has done with a suggestion in this list so far. */
export type SuggestionStatus =
  | { kind: 'idle' }
  | { kind: 'enabling' }
  | { kind: 'enabled'; routineId: string }
  | { kind: 'failed'; message: string };

/** The byline under a suggestion's title: who suggests it, and why. */
export function suggestionByline(
  from: SuggestionFrom,
  reason: string | null | undefined
): string {
  if (from === 'macro') return 'Template from Macro';
  const why = reason?.trim();
  return why ? `For you · ${why}` : 'For you';
}

function isKnobValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** The catalog step's knobs with AI's values; knobs it left out keep theirs. */
function suggestedKnobs(
  knobs: readonly Knob[],
  values: CatalogPick['knobs']
): Knob[] {
  let result = [...knobs];
  for (const [name, value] of Object.entries(values)) {
    if (isKnobValue(value)) result = withKnobValue(result, name, value);
  }
  return result;
}

export type SuggestionContext = {
  /** Who runs Ask AI steps. */
  target: RoutineTarget;
  /** Code steps can be saved (`enable-routine-code-steps`). */
  codeSteps: boolean;
  /** A blank new routine to start from. */
  base: ScheduleDraft;
};

function catalogDraft(
  pick: CatalogPick,
  entry: RoutineTemplate,
  context: SuggestionContext
): ScheduleDraft {
  const draft = templateDraft(entry, context.base, context);
  const steps = draft.steps?.map(
    (step): StepDraft =>
      step.kind === 'code'
        ? {
            ...step,
            knobs: suggestedKnobs(step.knobs, pick.knobs),
          }
        : step
  );
  // Its description says what it does with the values it starts with.
  const code = steps?.find((step) => step.kind === 'code');
  const description =
    (code?.kind === 'code' && sentenceText(code.sentence, code.knobs)) ||
    draft.description;
  return { ...draft, ...(steps ? { steps } : {}), description };
}

/** A drafted routine as the editor's draft; it was checked as saving would. */
function draftedDraft(routine: ActionConfiguration): ScheduleDraft | undefined {
  const schedule: ScheduledAction = {
    ...routine,
    run_visibility: routine.run_visibility ?? 'unlisted',
    configuration_revision: 0,
    created_at: '',
    updated_at: '',
    owner: '',
  };
  const draft = draftFromSchedule(schedule);
  if (!draft) return undefined;
  const { id: _none, ...fresh } = draft;
  return fresh;
}

/**
 * A suggestion as its row shows it, or undefined when it can't be shown: a
 * catalog pick the catalog doesn't (yet) have, or a draft the editor can't
 * read.
 */
export function suggestionItem(
  suggestion: RoutineSuggestion,
  catalog: readonly RoutineTemplate[],
  context: SuggestionContext
): SuggestionItem | undefined {
  const shared = {
    id: suggestion.id,
    from: suggestion.from,
    kind: suggestion.kind,
    surfaces: suggestion.surfaces,
    byline: suggestionByline(suggestion.from, suggestion.reason),
  };
  if (suggestion.kind === 'catalog') {
    const entry = catalog.find((routine) => routine.key === suggestion.key);
    if (!entry) return undefined;
    const draft = catalogDraft(suggestion, entry, context);
    return {
      ...shared,
      catalogKey: suggestion.key,
      title: entry.title,
      summary: draft.description || entry.description,
      when: templateChain(entry).trigger,
      needsPersonalTags:
        context.codeSteps && Object.values(entry.namedKnobs).includes('tag'),
      reviewFirst: false,
      draft: { ...draft, enabled: true, suggestionId: suggestion.id },
    };
  }
  const draft = draftedDraft(suggestion.routine);
  if (!draft) return undefined;
  const [first] = draft.triggers ?? [];
  return {
    ...shared,
    title: suggestion.routine.name,
    summary: suggestion.routine.description ?? '',
    when: first ? describeTrigger(first) : '',
    needsPersonalTags: false,
    reviewFirst: true,
    draft: { ...draft, enabled: true, suggestionId: suggestion.id },
  };
}

/** A suggestion's name, for the sidebar card's teaser. */
export function suggestionTitle(
  suggestion: RoutineSuggestion,
  catalog: readonly RoutineTemplate[]
): string | undefined {
  if (suggestion.kind === 'routine') return suggestion.routine.name;
  return catalog.find((routine) => routine.key === suggestion.key)?.title;
}

/** The row's editable fields before the person changes anything. */
export function initialEdits(item: SuggestionItem): SuggestionEdits {
  return {
    title: item.draft.name,
    // Only a lone Ask AI routine keeps its instructions in `prompt`.
    instructions:
      item.draft.steps === undefined ? item.draft.prompt : undefined,
    notify: item.draft.runVisibility === 'listed',
  };
}

/** The routine to save, with the person's edits applied. */
export function draftWithEdits(
  item: SuggestionItem,
  edits: SuggestionEdits
): ScheduleDraft {
  const instructions = edits.instructions?.trim();
  return {
    ...item.draft,
    name: edits.title.trim() || item.draft.name,
    ...(item.draft.steps === undefined && instructions
      ? { prompt: instructions }
      : {}),
    runVisibility: edits.notify ? 'listed' : 'unlisted',
  };
}

/** The suggestions a surface's sidebar shows, in the server's order. */
export function suggestionsFor<T extends { surfaces: readonly string[] }>(
  items: readonly T[] | undefined,
  surface: RoutineSurface
): T[] | undefined {
  return items?.filter((item) => item.surfaces.includes(surface));
}

/** A row enabled from a list, and the rows that were above it, top first. */
export type EnabledRow<T> = { item: T; above: readonly string[] };

/**
 * The list with suggestions enabled from it put back where they were, below
 * the nearest row that was above them: the server drops saved ones, but the row stays
 * to say it's on and to open it.
 */
export function withEnabledInPlace<T extends { id: string }>(
  items: readonly T[],
  enabled: readonly EnabledRow<T>[]
): T[] {
  const result = [...items];
  for (const kept of enabled) {
    if (result.some((item) => item.id === kept.item.id)) continue;
    // After the nearest row above it that is still listed.
    const nearest = kept.above.findLast((id) =>
      result.some((item) => item.id === id)
    );
    const before = result.findIndex((item) => item.id === nearest);
    result.splice(before + 1, 0, kept.item);
  }
  return result;
}
