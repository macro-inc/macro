import { Telemetry } from '@macro-inc/observability';
import type {
  RoutineSuggestion,
  Surface,
} from '@service-scheduled-action/generated/schemas';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import type { OnboardingContext } from '../context/onboarding-context';
import {
  emptySurfaces,
  initiallyOn,
  SUGGESTION_WAIT_MS,
  type SuggestionEdits,
  type SuggestionRow,
  suggestionsView,
} from '../core/routine-suggestions';

type RoutinesStepCapabilities = Pick<
  OnboardingContext,
  'createRoutinesStep' | 'track'
>;

/** A suggestion the step can show, with how it reads. */
export type ShownSuggestion = {
  suggestion: RoutineSuggestion;
  row: SuggestionRow;
};

/** What the step shows. */
export type RoutinesStepView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'items'; items: ShownSuggestion[]; arriving: boolean };

/** What the person has done with a suggestion so far. */
export type SuggestionStatus = 'idle' | 'enabling' | 'enabled' | 'failed';

/**
 * The last step. While AI is suggesting, only its suggestions show, as they
 * land. After {@link SUGGESTION_WAIT_MS}, surfaces it left empty fill with
 * Macro's templates; once AI is done, every surface is topped up to the
 * server's three. Each has a switch, off unless the scheduler marks it on by
 * default. Finishing creates the switched-on ones; those that fail stay on
 * their rows and finishing again retries only them, so nothing is created
 * twice.
 */
export function createRoutinesStep(
  context: RoutinesStepCapabilities,
  options: { now?: () => number } = {}
) {
  const now = options.now ?? (() => performance.now());
  const step = context.createRoutinesStep();
  const startedAt = now();
  // When the wait runs out, the surfaces AI left empty fill with Macro's
  // templates. They stay filled: rows don't vanish as AI catches up.
  const [filled, setFilled] = createSignal<readonly Surface[]>();
  const timer = setTimeout(
    () => setFilled(emptySurfaces(untrack(step.answer)?.suggestions ?? [])),
    SUGGESTION_WAIT_MS
  );
  onCleanup(() => clearTimeout(timer));

  const decided = createMemo(() => {
    const answer = step.answer();
    return answer && suggestionsView({ answer, filled: filled() });
  });
  const items = createMemo((): ShownSuggestion[] => {
    const current = decided();
    if (!current) return [];
    return current.suggestions.flatMap((suggestion) => {
      const row = step.row(suggestion);
      return row ? [{ suggestion, row }] : [];
    });
  });

  // Switches the person flipped; the rest follow the defaults.
  const [choices, setChoices] = createSignal<Record<string, boolean>>({});
  const [edits, setEdits] = createSignal<Record<string, SuggestionEdits>>({});
  const [statuses, setStatuses] = createSignal<
    Record<string, SuggestionStatus>
  >({});
  const [expandedId, setExpandedId] = createSignal<string>();
  const [enabling, setEnabling] = createSignal(false);
  const defaults = createMemo(() =>
    initiallyOn(items().map((item) => item.suggestion))
  );
  const isOn = (id: string) => choices()[id] ?? defaults().includes(id);
  const selected = () => items().filter((item) => isOn(item.row.id));
  const statusFor = (id: string): SuggestionStatus => statuses()[id] ?? 'idle';
  const setStatus = (id: string, status: SuggestionStatus) =>
    setStatuses((all) => ({ ...all, [id]: status }));
  const editsFor = (item: ShownSuggestion): SuggestionEdits =>
    edits()[item.row.id] ?? { name: item.row.title, notify: false };

  const view = createMemo((): RoutinesStepView => {
    const current = decided();
    if (!current)
      return step.failed() ? { kind: 'error' } : { kind: 'loading' };
    const shown = items();
    // Rows wait on the catalog, and AI's first suggestion may still come.
    if (shown.length === 0)
      return current.arriving || current.suggestions.length > 0
        ? { kind: 'loading' }
        : { kind: 'empty' };
    return {
      kind: 'items',
      items: shown,
      arriving: current.arriving,
    };
  });

  // Analytics: when AI's first suggestion showed, and how the list settled.
  let firstShownMs: number | undefined;
  let settledReported = false;
  createEffect(
    on([decided, items], ([current, shown]) => {
      if (!current) return;
      const forYou = shown.filter(
        (item) => item.row.byline.from === 'for_you'
      ).length;
      if (firstShownMs === undefined && forYou > 0)
        firstShownMs = Math.round(now() - startedAt);
      if (!current.settled || settledReported) return;
      // Rows wait on the catalog; report the list once it reads.
      if (shown.length === 0 && current.suggestions.length > 0) return;
      settledReported = true;
      context.track('onboarding_v4_routines_shown', {
        shown: shown.length,
        for_you: forYou,
        on_by_default: untrack(defaults).length,
        fallback: current.fallback,
        waited_out: untrack(filled) !== undefined,
        status: untrack(step.answer)?.status ?? 'none',
        first_suggestion_ms: firstShownMs ?? null,
      });
    })
  );

  const report = (enabled: readonly ShownSuggestion[]) => {
    context.track('onboarding_v4_routines', {
      suggested: items().length,
      recommended: defaults().length,
      enabled: enabled.length,
      recommended_kept: enabled.filter((item) =>
        defaults().includes(item.row.id)
      ).length,
      for_you_enabled: enabled.filter(
        (item) => item.row.byline.from === 'for_you'
      ).length,
    });
  };

  async function createOne(item: ShownSuggestion): Promise<boolean> {
    setStatus(item.row.id, 'enabling');
    try {
      await step.create(item.suggestion, editsFor(item));
      setStatus(item.row.id, 'enabled');
      return true;
    } catch {
      setStatus(item.row.id, 'failed');
      return false;
    }
  }

  function enable(pending: readonly ShownSuggestion[]) {
    return Telemetry.span('onboarding.routines.enable', async (span) => {
      span.setAttr('routines.selected', pending.length);
      const outcomes = await Promise.all(pending.map(createOne));
      span.setAttr('routines.failed', outcomes.filter((ok) => !ok).length);
      return outcomes.every(Boolean);
    });
  }

  return {
    view,
    /** AI is still suggesting and the wait isn't over. */
    waiting: () => !decided()?.settled && !step.failed(),
    refresh: step.refresh,
    isOn,
    setOn(id: string, on: boolean) {
      setChoices((all) => ({ ...all, [id]: on }));
    },
    statusFor,
    editsFor,
    edit(item: ShownSuggestion, next: SuggestionEdits) {
      setEdits((all) => ({ ...all, [item.row.id]: next }));
      if (statusFor(item.row.id) === 'failed') setStatus(item.row.id, 'idle');
    },
    isExpanded: (id: string) => expandedId() === id,
    setExpanded: (id: string, expanded: boolean) =>
      setExpandedId(expanded ? id : undefined),
    selectedCount: () => selected().length,
    anyFailed: () =>
      selected().some((item) => statusFor(item.row.id) === 'failed'),
    enabling,
    /** Turns on the chosen routines, then leaves; stays when one fails. */
    async turnOnAndFinish(onFinish: () => void) {
      if (enabling()) return;
      setEnabling(true);
      const pending = selected().filter(
        (item) => statusFor(item.row.id) !== 'enabled'
      );
      let ok: boolean;
      try {
        ok = await enable(pending);
      } finally {
        setEnabling(false);
      }
      if (!ok) return;
      report(selected());
      onFinish();
    },
    /** Leaves without turning anything else on. */
    skip(onFinish: () => void) {
      if (enabling()) return;
      // Routines a partly failed attempt already created stay on.
      report(items().filter((item) => statusFor(item.row.id) === 'enabled'));
      onFinish();
    },
  };
}

export type RoutinesStep = ReturnType<typeof createRoutinesStep>;
