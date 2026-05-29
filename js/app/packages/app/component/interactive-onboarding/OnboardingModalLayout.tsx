import MacroLogo from '@core/component/MacroLogo';
import { Button, Hotkey } from '@ui';
import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { OnboardingProgress } from './OnboardingProgress';
import { useOnboarding } from './onboarding-context';
import type { LessonContentProps, LessonState } from './types';

interface OnboardingModalLayoutProps {
  lesson: LessonState;
  bodyStyle: () => JSX.CSSProperties;
}

function LessonContent(props: {
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

function ModalFooter(props: { lesson: LessonState }) {
  const onboarding = useOnboarding();

  return (
    <footer class="shrink-0 px-4 pt-3 pb-0 bg-surface flex items-center justify-between gap-4">
      <div class="flex items-center gap-3 min-w-0">
        <OnboardingProgress
          lessons={[...onboarding.state.lessons()]}
          currentIndex={onboarding.state.currentIndex()}
        />
        <span class="text-xs text-ink-extra-muted/50 font-mono shrink-0">
          {onboarding.state.currentIndex() + 1} /{' '}
          {onboarding.state.lessons().length}
        </span>
      </div>

      <Show when={!props.lesson.definition.hideContinue}>
        <div class="flex items-center justify-end gap-2 shrink-0">
          <Button
            variant="base"
            // size="lg"
            onClick={onboarding.handleSkipLesson}
          >
            Skip lesson
          </Button>
          <Button
            ref={onboarding.setContinueButtonRef}
            variant="cta"
            // size="lg"
            onClick={onboarding.handleContinue}
            disabled={!onboarding.readyToContinue()}
          >
            {onboarding.continueLabel() ?? 'Continue'}
            <Hotkey shortcut="cmd+enter" theme="current" />
          </Button>
        </div>
      </Show>
    </footer>
  );
}

function DemoFallback() {
  return (
    <div class="flex items-center justify-center h-full">
      <div class="w-full m-12 opacity-10 max-w-80">
        <MacroLogo class="fill-ink" />
      </div>
    </div>
  );
}

export function OnboardingModalLayout(props: OnboardingModalLayoutProps) {
  return (
    <div class="size-full flex flex-col bg-surface text-ink">
      <div class="flex-1 min-h-0 flex gap-12">
        <aside class="w-105 shrink-0 flex flex-col">
          <div class="flex-1 overflow-y-auto px-4 py-4">
            <div style={props.bodyStyle()}>
              <h3 class="text-3xl font-semibold text-ink">
                {props.lesson.definition.title}
              </h3>
              <Show when={props.lesson.definition.subtitle}>
                <p class="text-sm text-ink/60 mt-2 mb-4">
                  {props.lesson.definition.subtitle}
                </p>
              </Show>

              <LessonContent
                lesson={props.lesson}
                component={props.lesson.definition.content}
              />
            </div>
          </div>
        </aside>

        <main class="flex-1 min-w-0 flex flex-col bg-surface-secondary/30">
          <div class="flex-1 min-h-0 overflow-hidden">
            <div style={props.bodyStyle()} class="size-full">
              <Show
                when={props.lesson.definition.demo}
                fallback={<DemoFallback />}
              >
                {(Demo) => (
                  <LessonContent lesson={props.lesson} component={Demo()} />
                )}
              </Show>
            </div>
          </div>
        </main>
      </div>
      <ModalFooter lesson={props.lesson} />
    </div>
  );
}
