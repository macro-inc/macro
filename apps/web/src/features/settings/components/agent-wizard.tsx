import { animateOnboardingStep } from '@app/features/onboarding/components/motion/step-transition';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import { Button, cn } from '@ui';
import { createEffect, For, type JSX, on, Show } from 'solid-js';
import { AgentHero, AgentStage, AgentStageTitle } from './agent-stage';

/**
 * A one-question-per-screen shell on the agent stage: a slab headline under
 * the hero, progress along the top, and the step's actions right under its
 * fields. Steps own their fields; this owns the frame.
 */
export function AgentWizard(props: {
  /** Accessible name for the wizard region. */
  label: string;
  /** CSS color the backdrop glows in. */
  accent: string;
  hero: JSX.Element;
  /** Zero-based; equal to `stepCount` once every step is done. */
  step: number;
  stepCount: number;
  title: JSX.Element;
  description?: JSX.Element;
  children: JSX.Element;
  /** The step's buttons; a submit button continues through the form. */
  actions: JSX.Element;
  onBack?: () => void;
  onCancel?: () => void;
  busy?: boolean;
  onSubmit: () => void;
}) {
  let body!: HTMLDivElement;
  createEffect(
    on(
      () => props.step,
      () => {
        animateOnboardingStep(body, 'in');
        body.querySelector('h1')?.focus({ preventScroll: true });
        const scroller = body.closest('[data-agent-stage-scroll]');
        if (scroller) scroller.scrollTop = 0;
      },
      { defer: true }
    )
  );
  return (
    <AgentStage
      label={props.label}
      accent={props.accent}
      header={{
        start: (
          <Show when={props.onBack}>
            {(onBack) => (
              <Button
                type="button"
                variant="ghost"
                size="icon-md"
                aria-label="Back"
                disabled={props.busy}
                onClick={onBack()}
              >
                <ArrowLeftIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
              </Button>
            )}
          </Show>
        ),
        center: (
          <div aria-hidden="true" class="flex items-center gap-1.5">
            <For each={Array.from({ length: props.stepCount }, (_, i) => i)}>
              {(index) => (
                <span
                  class={cn(
                    'h-1 w-7 rounded-full transition-colors duration-300',
                    index <= props.step ? 'bg-ink' : 'bg-ink/12'
                  )}
                />
              )}
            </For>
          </div>
        ),
        end: (
          <Show when={props.onCancel}>
            {(onCancel) => (
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={props.busy}
                onClick={onCancel()}
              >
                Cancel
              </Button>
            )}
          </Show>
        ),
      }}
    >
      <form
        class="flex w-full flex-1 flex-col items-center justify-center"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <div
          ref={body}
          class="flex w-full max-w-lg flex-col items-center text-center"
        >
          <p class="sr-only">
            {props.step < props.stepCount
              ? `Step ${props.step + 1} of ${props.stepCount}`
              : 'Done'}
          </p>
          <AgentHero>{props.hero}</AgentHero>
          <AgentStageTitle>{props.title}</AgentStageTitle>
          <Show when={props.description}>
            <p class="mt-3 max-w-[420px] text-sm leading-6 text-ink-muted [text-wrap:balance] sm:text-[15px]">
              {props.description}
            </p>
          </Show>
          <div class="mt-8 w-full text-left empty:hidden">{props.children}</div>
          <div class="mt-8 flex flex-wrap items-center justify-center gap-2">
            {props.actions}
          </div>
        </div>
      </form>
    </AgentStage>
  );
}
