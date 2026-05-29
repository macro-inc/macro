import MacroLogo from '@core/component/MacroLogo';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ContinueButton } from './components-lib';
import { OnboardingProgress } from './OnboardingProgress';
import { useOnboarding } from './onboarding-context';
import type { LessonState } from './types';

function LessonDynamic(props: { lesson: LessonState; component: any }) {
  const onboarding = useOnboarding();

  return (
    <Dynamic
      component={props.component}
      onComplete={onboarding.handleLessonComplete}
      onUnready={onboarding.handleLessonUnready}
      advance={onboarding.advanceLesson}
      skipLesson={onboarding.state.skipLesson}
      goToLesson={onboarding.state.goToLessonById}
      isActive={true}
      scopeId={onboarding.scopeId}
    />
  );
}

function LessonActions(props: {
  lesson: LessonState;
  continueLabel: () => string | undefined;
}) {
  const onboarding = useOnboarding();

  return (
    <Show when={!props.lesson.definition.hideContinue}>
      <div class="flex flex-col gap-2">
        <ContinueButton
          ref={onboarding.setContinueButtonRef}
          onClick={onboarding.handleContinue}
          label={props.continueLabel()}
          disabled={!onboarding.readyToContinue()}
          centered={props.lesson.definition.centeredButton}
        />
        <Show when={props.lesson.definition.secondaryAction}>
          {(Action) => (
            <LessonDynamic lesson={props.lesson} component={Action()} />
          )}
        </Show>
        <Button
          variant="ghost"
          size="sm"
          onClick={onboarding.handleSkipLesson}
          class="justify-center rounded-xs text-ink/50"
        >
          Skip lesson
        </Button>
      </div>
    </Show>
  );
}

export function OnboardingMobileLesson(props: {
  lesson: LessonState;
  bodyStyle: () => Record<string, string>;
  continueLabel: () => string | undefined;
}) {
  return (
    <div class="size-full flex flex-col items-center overflow-y-auto p-6">
      <div
        style={props.bodyStyle()}
        class="flex flex-col items-start text-left gap-6 w-full max-w-md mt-4"
      >
        <h2 class="text-3xl font-semibold text-ink">
          {props.lesson.definition.title}
        </h2>
        <Show when={props.lesson.definition.subtitle}>
          <p class="text-base text-ink/60">
            {props.lesson.definition.subtitle}
          </p>
        </Show>
        <div class="onboarding-stagger">
          <LessonDynamic
            lesson={props.lesson}
            component={props.lesson.definition.content}
          />
        </div>
        <Show when={props.lesson.definition.demo}>
          {(Demo) => (
            <div class="w-full">
              <LessonDynamic lesson={props.lesson} component={Demo()} />
            </div>
          )}
        </Show>
        <div class="w-full mt-2">
          <LessonActions
            lesson={props.lesson}
            continueLabel={props.continueLabel}
          />
        </div>
      </div>
    </div>
  );
}

export function OnboardingDesktopLesson(props: {
  lesson: LessonState;
  bodyStyle: () => Record<string, string>;
  headerStyle: () => Record<string, string>;
  continueLabel: () => string | undefined;
}) {
  const onboarding = useOnboarding();

  return (
    <>
      <div class="w-1/3 h-full min-w-0 flex flex-col">
        <div class="p-4">
          <div style={props.headerStyle()}>
            <div class="bg-ink text-surface text-xs font-mono size-4 flex items-center justify-center font-bold rounded-xs">
              {props.lesson.index + 1}
            </div>
            <Show when={onboarding.getPreviousLesson()}>
              {(prevLesson) => (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onboarding.handleBack(prevLesson())}
                  class="mt-6 gap-1.5 rounded-xs"
                >
                  <ArrowLeftIcon class="size-4" />
                  Back
                </Button>
              )}
            </Show>
            <h2
              class={cn(
                'text-3xl font-semibold text-ink-muted',
                onboarding.getPreviousLesson() ? 'mt-4' : 'mt-12'
              )}
            >
              {props.lesson.definition.title}
            </h2>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto px-4 flex flex-col">
          <div style={props.bodyStyle()}>
            <Show when={props.lesson.definition.subtitle}>
              <p class="text-sm text-ink/60 mb-4">
                {props.lesson.definition.subtitle}
              </p>
            </Show>
            <LessonDynamic
              lesson={props.lesson}
              component={props.lesson.definition.content}
            />
          </div>
          <div class="mt-8 pt-4">
            <LessonActions
              lesson={props.lesson}
              continueLabel={props.continueLabel}
            />
          </div>
        </div>

        <div class="flex flex-col gap-3 px-4 py-3">
          <div class="flex items-center justify-between gap-2">
            <OnboardingProgress
              lessons={[...onboarding.state.lessons()]}
              currentIndex={onboarding.state.currentIndex()}
            />
            <span class="text-xs text-ink-extra-muted/50 font-mono">
              {onboarding.state.currentIndex() + 1} /{' '}
              {onboarding.state.lessons().length}
            </span>
          </div>
        </div>
      </div>

      <div class="flex-1 min-w-0 flex items-center justify-center bg-surface-secondary/30 overflow-hidden">
        <div style={props.bodyStyle()} class="size-full">
          <Show
            when={props.lesson.definition.demo}
            fallback={
              <div class="flex items-center justify-center h-full">
                <div class="w-full m-12 opacity-10 max-w-80">
                  <MacroLogo class="fill-ink" />
                </div>
              </div>
            }
          >
            {(Demo) => (
              <LessonDynamic lesson={props.lesson} component={Demo()} />
            )}
          </Show>
        </div>
      </div>
    </>
  );
}
