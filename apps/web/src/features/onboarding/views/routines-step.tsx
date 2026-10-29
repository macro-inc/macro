import { RoutineSparkGlyph } from '@app/features/routine-suggestions/components/routine-spark-glyph';
import { RoutineSuggestionList } from '@app/features/routine-suggestions/components/routine-suggestion-list';
import {
  RoutineSuggestionRow,
  SuggestionToggle,
} from '@app/features/routine-suggestions/components/routine-suggestion-row';
import { routineSurfaceCopy } from '@app/features/routine-suggestions/core/surfaces';
import { suggestionListView } from '@app/features/routine-suggestions/views/suggestion-list-view';
import { fireAndForget } from '@core/util/fireAndForget';
import { For, Show } from 'solid-js';
import { ContinueButton, SkipButton } from '../components/controls';
import { useOnboardingContext } from '../context/onboarding-context';
import { createRoutinesStep } from '../primitives/routines-step';

/**
 * Put busywork on autopilot: every routine the AI suggested, grouped by
 * kind, with the ones it expects the user to keep already on.
 */
export function RoutinesStep(props: { finishing: boolean; onFinish(): void }) {
  const context = useOnboardingContext();
  const step = createRoutinesStep(context);
  const count = () => step.selection.selected().length;
  const busy = () => step.enabling() || props.finishing;
  const view = () =>
    suggestionListView({
      suggestions: step.source.suggestions(),
      generating: step.source.generating(),
      failed: step.source.error() !== undefined,
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
        <p class="mx-auto mt-6 max-w-[440px] text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          Routines are AI agents that run on their own. We picked these from
          your inbox and tools, and switched on the ones we think you'll keep.
          Change anything you like.
        </p>
      </header>
      <div class="mt-8 flex flex-col gap-6">
        <RoutineSuggestionList
          view={view()}
          emptyLabel="No routines to suggest yet. As your workspace grows, ideas show up in each sidebar."
          onRetry={() => fireAndForget(step.source.refresh(), 'onboarding')}
        >
          {() => (
            <For each={step.groups()}>
              {(group) => (
                <section aria-labelledby={`routine-group-${group.surface}`}>
                  <h2
                    id={`routine-group-${group.surface}`}
                    class="mb-1 px-3 text-xs font-medium tracking-wide text-ink-muted uppercase"
                  >
                    {routineSurfaceCopy[group.surface].groupLabel}
                  </h2>
                  <ul class="flex flex-col gap-1">
                    <For each={group.suggestions}>
                      {(suggestion) => {
                        const name = () =>
                          step.actions.editsFor(suggestion).title ||
                          suggestion.title;
                        return (
                          <RoutineSuggestionRow
                            suggestion={suggestion}
                            edits={step.actions.editsFor(suggestion)}
                            status={step.actions.statusFor(suggestion)}
                            expanded={step.actions.isExpanded(suggestion)}
                            onExpandedChange={(expanded) =>
                              step.actions.setExpanded(suggestion, expanded)
                            }
                            onEdit={(edits) =>
                              step.actions.edit(suggestion, edits)
                            }
                            action={
                              <SuggestionToggle
                                name={name()}
                                on={step.selection.isOn(suggestion)}
                                status={step.actions.statusFor(suggestion)}
                                onChange={(on) =>
                                  step.selection.setOn(suggestion, on)
                                }
                              />
                            }
                          />
                        );
                      }}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          )}
        </RoutineSuggestionList>
      </div>
      <Show when={step.failed()}>
        <p role="alert" class="mt-6 text-center text-sm text-failure">
          Some routines couldn't be turned on. Try again, or skip them for now.
        </p>
      </Show>
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
