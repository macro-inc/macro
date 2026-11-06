import { RoutineSparkGlyph } from '@app/features/routine-suggestions/components/routine-spark-glyph';
import { SuggestionIcon } from '@app/features/routine-suggestions/components/suggestion-icon';
import {
  ROUTINE_SURFACES,
  SURFACE_COPY,
} from '@app/features/routine-suggestions/core/surfaces';
import { fireAndForget } from '@core/util/fireAndForget';
import type { RoutineSuggestion } from '@service-scheduled-action/generated/schemas';
import { cn, ToggleSwitch } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import {
  KnobSettings,
  StepSentence,
} from '../../routines/components/routine-step-knobs';
import { knobsOutsideSentence } from '../../routines/core/knobs';
import { ContinueButton, SkipButton } from '../components/controls';
import { useOnboardingContext } from '../context/onboarding-context';
import { createRoutinesStep } from '../primitives/routines-step';

type StarterSuggestion = Extract<RoutineSuggestion, { kind: 'starter' }>;

/** One routine: its switch, what it does with its knobs in place, and why. */
function RoutineChoice(props: {
  suggestion: StarterSuggestion;
  step: ReturnType<typeof createRoutinesStep>;
  disabled: boolean;
}) {
  const entry = () =>
    props.step
      .catalog()
      .find((routine) => routine.key === props.suggestion.key);
  const code = () => {
    const [step] = props.step.draftFor(props.suggestion)?.steps ?? [];
    return step?.kind === 'code' ? step : undefined;
  };
  const created = () => props.step.created(props.suggestion);
  const onKnob = (name: string, value: Parameters<typeof props.step.edit>[2]) =>
    props.step.edit(props.suggestion, name, value);
  return (
    <Show when={entry()}>
      {(entry) => (
        <li
          class={cn(
            'flex list-none items-start gap-3 rounded-xl border border-transparent p-3',
            props.step.isOn(props.suggestion) && 'border-edge-muted bg-control'
          )}
        >
          <ToggleSwitch
            checked={props.step.isOn(props.suggestion)}
            disabled={props.disabled || created()}
            size="sm"
            class="mt-1 shrink-0"
            label={<span class="sr-only">Turn on {entry().title}</span>}
            onChange={(on) => props.step.setOn(props.suggestion, on)}
          />
          <SuggestionIcon
            surface={props.suggestion.surface}
            catalogKey={props.suggestion.key}
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ink">{entry().title}</p>
            <Show
              when={code()?.sentence}
              fallback={
                <p class="text-[15px] leading-7 text-ink-muted">
                  {entry().description}
                </p>
              }
            >
              {(sentence) => (
                <StepSentence
                  sentence={sentence()}
                  knobs={code()?.knobs ?? []}
                  onKnob={onKnob}
                />
              )}
            </Show>
            <Show
              when={
                knobsOutsideSentence(code()?.sentence, code()?.knobs ?? [])
                  .length
              }
            >
              <div class="mt-2">
                <KnobSettings
                  knobs={knobsOutsideSentence(
                    code()?.sentence,
                    code()?.knobs ?? []
                  )}
                  onKnob={onKnob}
                />
              </div>
            </Show>
            <p class="mt-1 text-xs text-ink-extra-muted">
              {props.suggestion.reason}
            </p>
            <Show when={props.step.failed(props.suggestion)}>
              <p role="alert" class="mt-1 text-xs text-failure">
                Couldn’t turn this on. Try again, or leave it off.
              </p>
            </Show>
            <Show when={created()}>
              <p class="mt-1 text-xs text-success">On</p>
            </Show>
          </div>
        </li>
      )}
    </Show>
  );
}

/**
 * Put busywork on autopilot: the catalog routines AI picked from the inbox
 * and tools, the safe ones already on. Every routine shows what it does
 * and its settings; the button turns on the ones left on.
 */
export function RoutinesStep(props: { finishing: boolean; onFinish(): void }) {
  const context = useOnboardingContext();
  const step = createRoutinesStep(context);
  const busy = () => step.enabling() || props.finishing;
  const count = () => step.selectedCount();
  const groups = () =>
    ROUTINE_SURFACES.flatMap((surface) => {
      const suggestions = step
        .suggestions()
        .filter((suggestion) => suggestion.surface === surface);
      return suggestions.length ? [{ surface, suggestions }] : [];
    });
  return (
    <section class="mx-auto flex w-full max-w-2xl flex-col py-2 sm:py-4">
      <header class="flex flex-col items-center text-center">
        <RoutineSparkGlyph size="lg" />
        <h1
          tabindex="-1"
          class="mt-5 font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight outline-none text-balance"
        >
          Put your busywork on autopilot.
        </h1>
        <p class="mx-auto mt-6 max-w-[460px] text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          Routines run on their own. We picked these from your inbox and tools,
          and switched on a few that only change your own mail and tasks. Change
          anything before you turn them on.
        </p>
      </header>
      <div class="mt-8 flex flex-col gap-6">
        <Switch>
          <Match when={step.suggestions().length > 0}>
            <For each={groups()}>
              {(group) => (
                <section aria-labelledby={`routine-group-${group.surface}`}>
                  <h2
                    id={`routine-group-${group.surface}`}
                    class="mb-1 px-3 text-xs font-medium tracking-wide text-ink-muted uppercase"
                  >
                    {SURFACE_COPY[group.surface].label}
                  </h2>
                  <ul class="flex flex-col gap-1">
                    <For each={group.suggestions}>
                      {(suggestion) => (
                        <RoutineChoice
                          suggestion={suggestion}
                          step={step}
                          disabled={busy()}
                        />
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </Match>
          <Match when={step.loadFailed()}>
            <p class="text-center text-sm text-ink-muted">
              We couldn’t pick routines for you right now.{' '}
              <button
                type="button"
                class="text-ink underline"
                onClick={() => fireAndForget(step.refresh(), 'onboarding')}
              >
                Try again
              </button>
            </p>
          </Match>
          <Match when={step.picking()}>
            <p class="text-center text-sm text-ink-muted" aria-live="polite">
              Picking routines from your inbox and tools…
            </p>
          </Match>
          <Match when={step.suggestions().length === 0}>
            <p class="text-center text-sm text-ink-muted">
              No routines to suggest yet. As your workspace fills up, ideas show
              up in each sidebar.
            </p>
          </Match>
        </Switch>
      </div>
      <ContinueButton
        label={
          props.finishing
            ? 'Opening your workspace…'
            : step.enabling()
              ? 'Turning on routines…'
              : count() > 0
                ? `Turn on ${count()} ${count() === 1 ? 'routine' : 'routines'}`
                : 'Continue to workspace'
        }
        disabled={busy()}
        onClick={() =>
          fireAndForget(step.turnOnAndFinish(props.onFinish), 'onboarding')
        }
      />
      <Show when={count() > 0}>
        <SkipButton
          disabled={busy()}
          onClick={() => step.skip(props.onFinish)}
        />
      </Show>
    </section>
  );
}
