import MacroLogo from '@core/component/MacroLogo';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { Button, cn } from '@ui';
import { type Accessor, type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ContinueButton } from './components-lib';
import { OnboardingProgress } from './OnboardingProgress';
import { useOnboarding } from './onboarding-context';
import type { LessonContentProps, LessonState } from './types';

interface LessonProps {
  lesson: LessonState;
}

interface LessonStyleProps extends LessonProps {
  bodyStyle: Accessor<JSX.CSSProperties>;
}

interface LessonActionsProps extends LessonProps {
  continueLabel: Accessor<string | undefined>;
}

export function OnboardingLessonContent(props: {
  lesson: LessonState;
  component: Component<LessonContentProps>;
}) {
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

export function OnboardingLessonActions(props: LessonActionsProps) {
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
            <OnboardingLessonContent
              lesson={props.lesson}
              component={Action()}
            />
          )}
        </Show>
        <button
          type="button"
          onClick={onboarding.handleSkipLesson}
          class={cn(
            'w-full px-3 py-2.5 text-lg font-bold rounded-xs flex items-center gap-2 border-none bg-transparent text-ink/60 hover:bg-hover ring-1 ring-edge-muted',
            props.lesson.definition.centeredButton
              ? 'justify-center'
              : 'justify-between'
          )}
        >
          Skip lesson
        </button>
      </div>
    </Show>
  );
}

export function OnboardingLessonTitle(props: LessonProps) {
  return <>{props.lesson.definition.title}</>;
}

export function OnboardingLessonSubtitle(
  props: LessonProps & { class: string }
) {
  return (
    <Show when={props.lesson.definition.subtitle}>
      <p class={props.class}>{props.lesson.definition.subtitle}</p>
    </Show>
  );
}

export function OnboardingDesktopHeader(
  props: LessonProps & { headerStyle: Accessor<JSX.CSSProperties> }
) {
  const onboarding = useOnboarding();
  const previousLesson = () => onboarding.getPreviousLesson();

  return (
    <div class="p-4">
      <div style={props.headerStyle()}>
        <div class="bg-ink text-surface text-xs font-mono size-4 flex items-center justify-center font-bold rounded-xs">
          {props.lesson.index + 1}
        </div>
        <Show when={previousLesson()}>
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
            previousLesson() ? 'mt-4' : 'mt-12'
          )}
        >
          <OnboardingLessonTitle lesson={props.lesson} />
        </h2>
      </div>
    </div>
  );
}

export function OnboardingLessonBody(props: LessonStyleProps) {
  return (
    <div style={props.bodyStyle()}>
      <OnboardingLessonSubtitle
        lesson={props.lesson}
        class="text-sm text-ink/60 mb-4"
      />
      <OnboardingLessonContent
        lesson={props.lesson}
        component={props.lesson.definition.content}
      />
    </div>
  );
}

export function OnboardingLessonFooter() {
  const onboarding = useOnboarding();

  return (
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
  );
}

export function OnboardingDemoFallback() {
  return (
    <div class="flex items-center justify-center h-full">
      <div class="w-full m-12 opacity-10 max-w-80">
        <MacroLogo class="fill-ink" />
      </div>
    </div>
  );
}

export function OnboardingDemoPanel(props: LessonStyleProps) {
  return (
    <div class="flex-1 min-w-0 flex items-center justify-center bg-surface-secondary/30 overflow-hidden">
      <div style={props.bodyStyle()} class="size-full">
        <Show
          when={props.lesson.definition.demo}
          fallback={<OnboardingDemoFallback />}
        >
          {(Demo) => (
            <OnboardingLessonContent lesson={props.lesson} component={Demo()} />
          )}
        </Show>
      </div>
    </div>
  );
}

export function OnboardingDesktopSidebar(
  props: LessonStyleProps & {
    headerStyle: Accessor<JSX.CSSProperties>;
    continueLabel: Accessor<string | undefined>;
  }
) {
  return (
    <div class="w-1/3 h-full min-w-0 flex flex-col">
      <OnboardingDesktopHeader
        lesson={props.lesson}
        headerStyle={props.headerStyle}
      />

      <div class="flex-1 overflow-y-auto px-4 flex flex-col">
        <OnboardingLessonBody
          lesson={props.lesson}
          bodyStyle={props.bodyStyle}
        />
        <div class="mt-8 pt-4">
          <OnboardingLessonActions
            lesson={props.lesson}
            continueLabel={props.continueLabel}
          />
        </div>
      </div>

      <OnboardingLessonFooter />
    </div>
  );
}

export function OnboardingMobileLesson(
  props: LessonStyleProps & { continueLabel: Accessor<string | undefined> }
) {
  return (
    <div class="size-full flex flex-col items-center overflow-y-auto p-6">
      <div
        style={props.bodyStyle()}
        class="flex flex-col items-start text-left gap-6 w-full max-w-md mt-4"
      >
        <h2 class="text-3xl font-semibold text-ink">
          <OnboardingLessonTitle lesson={props.lesson} />
        </h2>
        <OnboardingLessonSubtitle
          lesson={props.lesson}
          class="text-base text-ink/60"
        />
        <div class="onboarding-stagger">
          <OnboardingLessonContent
            lesson={props.lesson}
            component={props.lesson.definition.content}
          />
        </div>
        <Show when={props.lesson.definition.demo}>
          {(Demo) => (
            <div class="w-full">
              <OnboardingLessonContent
                lesson={props.lesson}
                component={Demo()}
              />
            </div>
          )}
        </Show>
        <div class="w-full mt-2">
          <OnboardingLessonActions
            lesson={props.lesson}
            continueLabel={props.continueLabel}
          />
        </div>
      </div>
    </div>
  );
}

export function OnboardingDesktopLesson(
  props: LessonStyleProps & {
    headerStyle: Accessor<JSX.CSSProperties>;
    continueLabel: Accessor<string | undefined>;
  }
) {
  return (
    <>
      <OnboardingDesktopSidebar
        lesson={props.lesson}
        bodyStyle={props.bodyStyle}
        headerStyle={props.headerStyle}
        continueLabel={props.continueLabel}
      />
      <OnboardingDemoPanel lesson={props.lesson} bodyStyle={props.bodyStyle} />
    </>
  );
}
