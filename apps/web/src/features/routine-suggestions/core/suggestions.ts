import type {
  ActionConfiguration,
  RoutineSuggestion,
  ScheduledAction,
  SuggestionFrom,
} from '@service-scheduled-action/generated/schemas';
import type { ScheduleDraft } from '../../routines/core/draft';
import {
  type Knob,
  sentenceParts,
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

type CatalogPick = Extract<RoutineSuggestion, { kind: 'catalog' }>;

/** A suggestion as its card shows it, with the routine it saves. */
export type SuggestionItem = {
  /** The suggestion's id; `template:<key>` for a template. */
  id: string;
  from: SuggestionFrom;
  kind: RoutineSuggestion['kind'];
  /**
   * One of Macro's templates offered beside the suggestions, not a
   * suggestion: it can't be dismissed, and its routine doesn't point back
   * at one.
   */
  template: boolean;
  /** The catalog routine it starts from, for catalog picks. */
  catalogKey?: string;
  /** The sidebars it shows in, first the one it belongs to most. */
  surfaces: RoutineSurface[];
  title: string;
  /** What it does, with AI's knob values filled in. */
  summary: string;
  /** What starts it and what it does, for its card's chain line. */
  chain: SuggestionChain;
  /** Why it fits the person, for AI's picks. */
  reason?: string;
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

/** What starts a routine and what it does, in a few words each. */
export type SuggestionChain = {
  trigger: string;
  action: string;
  /** The action is AI's, so the line marks it with a sparkle. */
  actionAi: boolean;
};

/** What the person changed before turning it on: its knobs' values. */
export type SuggestionEdits = {
  /** The sentence step's knobs; absent where it has none. */
  knobs?: Knob[];
};

/** What the person has done with a suggestion in this list so far. */
export type SuggestionStatus =
  | { kind: 'idle' }
  | { kind: 'enabling' }
  | { kind: 'enabled'; routineId: string }
  | { kind: 'failed'; message: string };

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
 * A suggestion as its card shows it, or undefined when it can't be shown: a
 * catalog pick the catalog doesn't (yet) have, or a draft the editor can't
 * read.
 */
export function suggestionItem(
  suggestion: RoutineSuggestion,
  catalog: readonly RoutineTemplate[],
  context: SuggestionContext
): SuggestionItem | undefined {
  const reason = suggestion.reason?.trim();
  const shared = {
    id: suggestion.id,
    from: suggestion.from,
    kind: suggestion.kind,
    template: false,
    surfaces: suggestion.surfaces,
    ...(suggestion.from === 'for_you' && reason ? { reason } : {}),
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
      chain: templateChain(entry),
      needsPersonalTags:
        context.codeSteps && Object.values(entry.namedKnobs).includes('tag'),
      reviewFirst: false,
      draft: { ...draft, enabled: true, suggestionId: suggestion.id },
    };
  }
  const draft = draftedDraft(suggestion.routine);
  if (!draft) return undefined;
  const [first] = draft.triggers ?? [];
  const [step] = draft.steps ?? [];
  return {
    ...shared,
    title: suggestion.routine.name,
    summary: suggestion.routine.description ?? '',
    chain: {
      trigger: first ? describeTrigger(first) : '',
      // A code step by its title; a lone Ask AI routine has no steps.
      action: step?.kind === 'code' ? step.title : 'Ask AI',
      actionAi: step?.kind !== 'code',
    },
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

/** One of Macro's templates as a card, beside the suggestions. */
export function templateItem(
  entry: RoutineTemplate,
  context: SuggestionContext
): SuggestionItem {
  const draft = templateDraft(entry, context.base, context);
  const code = sentenceStep(draft);
  const description =
    (code && sentenceText(code.sentence, code.knobs)) || draft.description;
  return {
    id: `template:${entry.key}`,
    from: 'macro',
    kind: 'catalog',
    template: true,
    catalogKey: entry.key,
    surfaces: entry.surfaces,
    title: entry.title,
    summary: description || entry.description,
    chain: templateChain(entry),
    needsPersonalTags:
      context.codeSteps && Object.values(entry.namedKnobs).includes('tag'),
    reviewFirst: false,
    draft: { ...draft, description, enabled: true },
  };
}

/** Where the code step whose sentence a card shows sits, and the step. */
function sentenceStep(
  draft: ScheduleDraft
): { index: number; sentence: string; knobs: Knob[] } | undefined {
  const steps = draft.steps ?? [];
  for (const [index, step] of steps.entries()) {
    if (
      step.kind === 'code' &&
      step.sentence &&
      sentenceParts(step.sentence, step.knobs)
    )
      return { index, sentence: step.sentence, knobs: step.knobs };
  }
  return undefined;
}

/** The sentence a card shows, with the person's knob values. */
export function suggestionSentence(
  item: SuggestionItem,
  edits: SuggestionEdits
): { sentence: string; knobs: Knob[] } | undefined {
  const step = sentenceStep(item.draft);
  return step && { sentence: step.sentence, knobs: edits.knobs ?? step.knobs };
}

/** The routine to save, with the person's knob values. */
export function draftWithEdits(
  item: SuggestionItem,
  edits: SuggestionEdits
): ScheduleDraft {
  const step = sentenceStep(item.draft);
  const knobs = edits.knobs;
  if (!step || !knobs) return item.draft;
  const steps = item.draft.steps?.map(
    (current, index): StepDraft =>
      index === step.index && current.kind === 'code'
        ? { ...current, knobs }
        : current
  );
  // A catalog routine's description is its sentence, so it follows the
  // values; a drafted routine keeps the description AI wrote.
  const description =
    item.kind === 'catalog'
      ? (sentenceText(step.sentence, knobs) ?? item.draft.description)
      : item.draft.description;
  return { ...item.draft, ...(steps ? { steps } : {}), description };
}

/** What a card's one action does. */
export type SuggestionAction = 'turn-on' | 'review' | 'use';

/**
 * AI's catalog picks turn on in a click; a drafted routine and Macro's
 * templates open in the editor first.
 */
export function suggestionAction(item: SuggestionItem): SuggestionAction {
  if (item.reviewFirst) return 'review';
  return item.from === 'for_you' ? 'turn-on' : 'use';
}

/**
 * The part of the app whose icon and tint a card shows. In a sidebar, where
 * every suggestion belongs to the same part, it is the first other part the
 * routine works in, else Calendar for a scheduled one, so the icons differ by
 * what each routine does; elsewhere it is the part it belongs to most.
 * Agents hosts every AI routine, so it says nothing about what one does.
 */
export function suggestionLook(
  item: Pick<SuggestionItem, 'surfaces' | 'draft'>,
  sidebar?: RoutineSurface
): RoutineSurface {
  if (!sidebar) return item.surfaces[0] ?? 'agents';
  const other = item.surfaces.find(
    (surface) => surface !== sidebar && surface !== 'agents'
  );
  if (other) return other;
  const scheduled = item.draft.triggers?.some(
    (trigger) => trigger.kind === 'schedule'
  );
  return scheduled ? 'calendar' : sidebar;
}

/**
 * The sidebar card's icon stack: up to three different looks, in the order
 * of the suggestions that have them, so the stack shows the variety on offer.
 */
export function stackLooks(
  items: readonly Pick<SuggestionItem, 'surfaces' | 'draft'>[],
  sidebar: RoutineSurface
): RoutineSurface[] {
  const looks: RoutineSurface[] = [];
  for (const item of items) {
    const look = suggestionLook(item, sidebar);
    if (!looks.includes(look)) looks.push(look);
    if (looks.length === 3) break;
  }
  return looks;
}

/**
 * Everything Discover offers: AI's picks first, then Macro's, each in the
 * server's order, then the templates no suggestion already offers.
 */
export function discoverItems(
  suggestions: readonly SuggestionItem[],
  templates: readonly SuggestionItem[]
): SuggestionItem[] {
  const offered = new Set(suggestions.map((item) => item.catalogKey));
  return [
    ...suggestions.filter((item) => item.from === 'for_you'),
    ...suggestions.filter((item) => item.from !== 'for_you'),
    ...templates.filter((item) => !offered.has(item.catalogKey)),
  ];
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
