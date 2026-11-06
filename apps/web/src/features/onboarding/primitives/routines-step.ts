import { Telemetry } from '@macro-inc/observability';
import type { RoutineSuggestion } from '@service-scheduled-action/generated/schemas';
import { createMemo, createSignal } from 'solid-js';
import type { ScheduleDraft } from '../../routines/core/draft';
import type { Knob } from '../../routines/core/knobs';
import type { OnboardingContext } from '../context/onboarding-context';
import {
  onboardingSuggestions,
  preselectedSuggestions,
} from '../core/routine-picks';

type StarterSuggestion = Extract<RoutineSuggestion, { kind: 'starter' }>;

type RoutinesStepCapabilities = Pick<
  OnboardingContext,
  'createRoutinesStep' | 'track'
>;

/** Knob values the person changed on a row, by knob name. */
export type KnobEdits = Record<string, Knob['value']>;

/**
 * The last step: the catalog routines AI picked, the safe ones already
 * switched on, each with its sentence and knobs to change. It is the review:
 * one button turns on the chosen ones. Those that fail stay on their rows
 * and the button retries only them, so nothing is created twice.
 */
export function createRoutinesStep(context: RoutinesStepCapabilities) {
  const step = context.createRoutinesStep();
  // Only what the catalog can show and build: a suggestion it doesn't
  // (yet) have is neither listed, counted nor created.
  const suggestions = createMemo(() =>
    onboardingSuggestions(step.suggestions() ?? []).filter((suggestion) =>
      step.catalog().some((routine) => routine.key === suggestion.key)
    )
  );
  // Switches the person flipped; the rest follow the defaults.
  const [choices, setChoices] = createSignal<Record<string, boolean>>({});
  const [edits, setEdits] = createSignal<Record<string, KnobEdits>>({});
  const [created, setCreated] = createSignal<string[]>([]);
  const [failed, setFailed] = createSignal<string[]>([]);
  const [enabling, setEnabling] = createSignal(false);
  const defaults = createMemo(() => preselectedSuggestions(suggestions()));
  const selected = () =>
    suggestions()
      .filter(
        (suggestion) =>
          choices()[suggestion.id] ?? defaults().includes(suggestion.id)
      )
      .map((suggestion) => suggestion.id);

  const isOn = (suggestion: RoutineSuggestion) =>
    selected().includes(suggestion.id);
  const draftFor = (suggestion: StarterSuggestion): ScheduleDraft | undefined =>
    step.draft(suggestion, edits()[suggestion.id] ?? {});

  const report = (enabled: readonly string[]) => {
    context.track('onboarding_v4_routines', {
      suggested: suggestions().length,
      recommended: defaults().length,
      enabled: enabled.length,
      recommended_kept: enabled.filter((id) => defaults().includes(id)).length,
    });
  };

  async function createOne(suggestion: StarterSuggestion): Promise<boolean> {
    try {
      const draft = draftFor(suggestion);
      if (!draft) return false;
      await step.create(suggestion, draft);
      setCreated((ids) => [...ids, suggestion.id]);
      return true;
    } catch {
      return false;
    }
  }

  function enable(pending: readonly StarterSuggestion[]) {
    return Telemetry.span('onboarding.routines.enable', async (span) => {
      span.setAttr('routines.selected', pending.length);
      const outcomes = await Promise.all(
        pending.map(async (suggestion) => ({
          id: suggestion.id,
          ok: await createOne(suggestion),
        }))
      );
      span.setAttr(
        'routines.failed',
        outcomes.filter((outcome) => !outcome.ok).length
      );
      return outcomes;
    });
  }

  return {
    suggestions,
    /** Nothing has been picked yet, or a pick is running. */
    picking: () =>
      step.generating() ||
      step.suggestions() === undefined ||
      step.catalog().length === 0,
    loadFailed: step.failed,
    refresh: step.refresh,
    catalog: step.catalog,
    isOn,
    setOn(suggestion: RoutineSuggestion, on: boolean) {
      setChoices((all) => ({ ...all, [suggestion.id]: on }));
    },
    edits: (suggestion: RoutineSuggestion) => edits()[suggestion.id] ?? {},
    edit(suggestion: RoutineSuggestion, name: string, value: Knob['value']) {
      setEdits((all) => ({
        ...all,
        [suggestion.id]: { ...all[suggestion.id], [name]: value },
      }));
    },
    draftFor,
    created: (suggestion: RoutineSuggestion) =>
      created().includes(suggestion.id),
    failed: (suggestion: RoutineSuggestion) => failed().includes(suggestion.id),
    selectedCount: () => selected().length,
    enabling,
    /** Turns on the chosen routines, then leaves; stays when one fails. */
    async turnOnAndFinish(onFinish: () => void) {
      if (enabling()) return;
      setEnabling(true);
      const pending = suggestions().filter(
        (suggestion) => isOn(suggestion) && !created().includes(suggestion.id)
      );
      let results: { id: string; ok: boolean }[];
      try {
        results = await enable(pending);
      } finally {
        setEnabling(false);
      }
      setFailed(results.filter((result) => !result.ok).map((r) => r.id));
      if (failed().length) return;
      report(selected());
      onFinish();
    },
    /** Leaves without turning anything else on. */
    skip(onFinish: () => void) {
      if (enabling()) return;
      // Routines a partly failed attempt already created stay on.
      report(created());
      onFinish();
    },
  };
}
