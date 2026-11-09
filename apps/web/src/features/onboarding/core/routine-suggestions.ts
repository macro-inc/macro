import type {
  GenerationStatus,
  RoutineSuggestion,
  Surface,
} from '@service-scheduled-action/generated/schemas';
import type { ScheduleDraft } from '../../routines/core/draft';
import {
  type Knob,
  sentenceText,
  withKnobValue,
} from '../../routines/core/knobs';
import type { StepDraft } from '../../routines/core/routine-steps';
import {
  type RoutineTemplate,
  templateDraft,
} from '../../routines/core/routine-templates';

export type CatalogSuggestion = Extract<RoutineSuggestion, { kind: 'catalog' }>;

/** How long the last step waits for AI's suggestions before showing the rest. */
export const SUGGESTION_WAIT_MS = 30_000;

/** How often the last step asks for suggestions while AI is still suggesting. */
export const SUGGESTION_POLL_MS = 2_000;

/** At most this many start switched on, so the first week isn't a wall of runs. */
const MAX_ON_BY_DEFAULT = 2;

/** One suggestion as the last step lists it. */
export type SuggestionRow = {
  id: string;
  /** The sidebar it belongs to most, for its icon and group. */
  surface: Surface;
  title: string;
  /** What it does, with AI's knob values filled in. */
  does: string;
  /** When it runs, e.g. "When an email arrives". */
  when?: string;
  byline: SuggestionByline;
};

/** Who suggests it: AI for this person with its reason, or Macro's template. */
export type SuggestionByline =
  | { from: 'for_you'; reason?: string }
  | { from: 'macro' };

/** What the person can change on a row before it is created. */
export type SuggestionEdits = {
  name: string;
  /** Show each run in Home. */
  notify: boolean;
};

export function suggestionByline(
  suggestion: RoutineSuggestion
): SuggestionByline {
  if (suggestion.from === 'macro') return { from: 'macro' };
  const reason = suggestion.reason?.trim();
  return reason ? { from: 'for_you', reason } : { from: 'for_you' };
}

/** The line under a suggestion's name that says who suggests it. */
export function bylineText(byline: SuggestionByline): string {
  if (byline.from === 'macro') return 'Template from Macro';
  return byline.reason ? `For you · ${byline.reason}` : 'For you';
}

/**
 * The suggestions switched on before the person changes anything: the ones
 * the scheduler marks on by default, at most two. A drafted routine never
 * is, whatever it says: the person reviews it first.
 */
export function initiallyOn(
  suggestions: readonly RoutineSuggestion[]
): string[] {
  return suggestions
    .filter(
      (suggestion) => suggestion.onByDefault && suggestion.kind === 'catalog'
    )
    .slice(0, MAX_ON_BY_DEFAULT)
    .map((suggestion) => suggestion.id);
}

/** What the last step shows, from the scheduler's answer and the wait. */
export type SuggestionsView = {
  /** In the server's order: per surface, drafted, catalog picks, templates. */
  suggestions: RoutineSuggestion[];
  /** AI is still suggesting: more may land. */
  arriving: boolean;
  /** The wait ran out or AI finished: templates fill in. */
  settled: boolean;
  /** No suggestion from AI shows, only Macro's templates. */
  fallback: boolean;
};

/** The surfaces none of AI's suggestions belong to yet. */
export function emptySurfaces(
  suggestions: readonly RoutineSuggestion[]
): Surface[] {
  const covered = new Set(
    suggestions
      .filter((suggestion) => suggestion.from === 'for_you')
      .flatMap((suggestion) => suggestion.surfaces)
  );
  return SURFACE_GROUPS.map((group) => group.surface).filter(
    (surface) => !covered.has(surface)
  );
}

/**
 * The server fills every surface to three with Macro's templates. While AI
 * is suggesting, only its suggestions show, as they land. Once the wait
 * runs out, `filled` names the surfaces that were still empty then, and
 * their templates show. Once AI is done (or never ran), the list shows as
 * the server sends it, every surface topped up.
 */
export function suggestionsView(input: {
  answer: { status: GenerationStatus; suggestions: RoutineSuggestion[] };
  /** Surfaces still empty when the wait ran out; undefined before then. */
  filled: readonly Surface[] | undefined;
}): SuggestionsView {
  const { status, suggestions } = input.answer;
  const fallback = !suggestions.some(
    (suggestion) => suggestion.from === 'for_you'
  );
  if (status !== 'generating') {
    return { suggestions, arriving: false, settled: true, fallback };
  }
  const filled = input.filled;
  const shown = suggestions.filter(
    (suggestion) =>
      suggestion.from === 'for_you' ||
      (filled !== undefined &&
        suggestion.surfaces.some((surface) => filled.includes(surface)))
  );
  return {
    suggestions: shown,
    arriving: true,
    settled: filled !== undefined,
    fallback,
  };
}

/** The order groups show in, and what heads each. */
export const SURFACE_GROUPS: readonly { surface: Surface; label: string }[] = [
  { surface: 'email', label: 'Email automations' },
  { surface: 'calendar', label: 'Calendar automations' },
  { surface: 'tasks', label: 'Task automations' },
  { surface: 'files', label: 'Document automations' },
  { surface: 'crm', label: 'CRM automations' },
  { surface: 'chat', label: 'Chat automations' },
  { surface: 'calls', label: 'Call automations' },
  { surface: 'reviews', label: 'Code review automations' },
  { surface: 'agents', label: 'Workspace automations' },
];

/** Rows grouped by the sidebar each belongs to most, in the groups' order. */
export function groupBySurface<T extends { row: SuggestionRow }>(
  items: readonly T[]
): { surface: Surface; label: string; items: T[] }[] {
  return SURFACE_GROUPS.flatMap((group) => {
    const members = items.filter((item) => item.row.surface === group.surface);
    return members.length ? [{ ...group, items: members }] : [];
  });
}

/** AI's knob values on the catalog routine's code step. */
function withSuggestedKnobs(
  knobs: readonly Knob[],
  values: CatalogSuggestion['knobs']
): Knob[] {
  let result = [...knobs];
  for (const [name, value] of Object.entries(values)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result = withKnobValue(result, name, value);
    }
  }
  return result;
}

/**
 * The routine a catalog suggestion becomes: its code where code can be
 * saved, else its Ask AI instructions, with AI's knob values applied.
 */
export function catalogSuggestionDraft(
  suggestion: CatalogSuggestion,
  entry: RoutineTemplate,
  base: ScheduleDraft,
  context: Parameters<typeof templateDraft>[2]
): ScheduleDraft {
  const draft = templateDraft(entry, base, context);
  const steps = draft.steps?.map(
    (step): StepDraft =>
      step.kind === 'code'
        ? { ...step, knobs: withSuggestedKnobs(step.knobs, suggestion.knobs) }
        : step
  );
  const [code] = (steps ?? []).filter((step) => step.kind === 'code');
  const description =
    (code?.kind === 'code' && sentenceText(code.sentence, code.knobs)) ||
    draft.description;
  return { ...draft, ...(steps ? { steps } : {}), description };
}
