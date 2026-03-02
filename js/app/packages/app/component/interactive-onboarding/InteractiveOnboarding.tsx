import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import MacroLogo from '@core/component/MacroLogo';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { useLocation } from '@solidjs/router';
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Transition } from 'solid-transition-group';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { createOnboardingState } from './create-onboarding-state';
import { LESSONS } from './lessons';
import { OnboardingProgress } from './OnboardingProgress';
import {
  clearCompletedLessons,
  loadCompletedLessons,
  saveCompletedLesson,
} from './persistence';
import { SplitHeaderLeft } from '../split-layout/components/SplitHeader';
import { StaticSplitLabel } from '../split-layout/components/SplitLabel';
import { ClippedPanel } from '@core/component/ClippedPanel';

export default function InteractiveOnboarding() {
  const splitPanel = useSplitPanel();
  const completeTutorial = useCompleteTutorialMutation();
  const location = useLocation();

  const testMode = new URLSearchParams(location.search).has('test');
  if (testMode) {
    clearCompletedLessons();
  }

  const state = createOnboardingState({
    definitions: LESSONS,
    initialCompleted: testMode ? new Set() : loadCompletedLessons(),
  });

  const [readyToContinue, setReadyToContinue] = createSignal(false);
  const [lessonKey, setLessonKey] = createSignal(0);

  const navigateAway = () => {
    splitPanel?.handle.replace({
      next: { type: 'component', id: 'unified-list' },
    });
  };

  const handleLessonComplete = () => {
    setReadyToContinue(true);
  };

  const handleContinue = () => {
    const current = state.currentLesson();
    if (!current || !readyToContinue()) return;

    state.completeLesson(current.definition.id);
    if (!testMode) {
      saveCompletedLesson(current.definition.id);
    }
    setReadyToContinue(false);
    setLessonKey((k) => k + 1);
  };

  const handleSkip = () => {
    const current = state.currentLesson();
    if (current) {
      state.skipLesson(current.definition.id);
      setReadyToContinue(false);
      setLessonKey((k) => k + 1);
    }
  };

  // cmd+enter hotkey to continue
  let shellRef: HTMLDivElement | undefined;
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('onboarding-shell');

  onMount(() => {
    if (shellRef) attachHotkeys(shellRef);
  });

  const reg = registerHotkey({
    scopeId,
    hotkey: 'cmd+enter',
    description: 'Continue',
    runWithInputFocused: true,
    keyDownHandler: () => {
      if (readyToContinue()) {
        handleContinue();
        return true;
      }
      return false;
    },
  });

  onCleanup(() => reg.dispose());

  createEffect(
    on(
      () => state.isFinished(),
      (finished) => {
        if (finished && !testMode) {
          completeTutorial.mutate(undefined);
          navigateAway();
        }
      }
    )
  );

  createEffect(
    on(
      () => state.dismissed(),
      (dismissed) => {
        if (dismissed) navigateAway();
      }
    )
  );

  const bodyStyle = () => ({
    animation: `onboarding-fade-up 300ms ease-out both`,
    '--onboarding-key': String(lessonKey()),
  });

  const headerStyle = () => ({
    animation: `onboarding-fade-up 200ms ease-out both`,
    '--onboarding-key': String(lessonKey()),
  });

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Welcome To Macro" />
      </SplitHeaderLeft>
      <div
        ref={shellRef}
        class="flex items-center justify-center h-full w-full"
        tabIndex={-1}
      >
        {/* Scoped keyframes */}
        <style>{`
        @keyframes onboarding-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes onboarding-scale-in {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

        {/* Centered card */}
        <div class="w-[1200px] h-[70%] max-w-[95vw] max-h-[90vh]">
          <ClippedPanel tl active>
            <div class="size-full flex">
              <Show
                when={state.currentLesson()}
                fallback={
                  <Show when={testMode && state.isFinished()}>
                    <div
                      class="flex flex-col items-center justify-center w-full gap-4"
                      style={{
                        animation: 'onboarding-scale-in 300ms ease-out both',
                      }}
                    >
                      <p class="text-sm text-ink/60">All lessons complete.</p>
                      <button
                        type="button"
                        class="px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/80 transition-colors"
                        onClick={() => window.location.reload()}
                      >
                        Replay
                      </button>
                    </div>
                  </Show>
                }
              >
                {(lesson) => (
                  <>
                    {/* Left panel — text content (~1/3) */}
                    <div class="w-1/3 h-full min-w-0 flex flex-col border-r border-edge-muted">
                      {/* Header */}
                      <div class="px-4 py-8">
                        <div
                          class="flex flex-col gap-0.5"
                          style={headerStyle()}
                        >
                          <h2 class="text-2xl font-semibold text-ink">
                            {lesson().definition.title}
                          </h2>
                          <p class="text-xs text-ink-extra-muted font-mono">
                            {state.currentIndex() + 1} of{' '}
                            {state.lessons().length}
                          </p>
                        </div>
                      </div>

                      {/* Body */}
                      <div class="flex-1 overflow-y-auto px-4 py-4">
                        <div style={bodyStyle()}>
                          <p class="text-sm text-ink/60 mb-4">
                            {lesson().definition.description}
                          </p>
                          <Dynamic
                            component={lesson().definition.content}
                            onComplete={handleLessonComplete}
                            isActive={true}
                          />
                        </div>
                      </div>

                      {/* Footer */}
                      <div class="flex items-center justify-between px-4 py-3 border-t border-ink/10">
                        <OnboardingProgress
                          lessons={[...state.lessons()]}
                          currentIndex={state.currentIndex()}
                        />
                        <div class="flex items-center gap-2">
                          <Show when={!readyToContinue()}>
                            <button
                              type="button"
                              class="px-3 py-1.5 text-xs text-ink/60 hover:text-ink/90 hover:bg-hover/30 rounded transition-colors"
                              onClick={handleSkip}
                            >
                              Skip
                            </button>
                          </Show>
                          <Show when={readyToContinue()}>
                            <button
                              type="button"
                              class="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/80 transition-colors flex items-center gap-1.5"
                              onClick={handleContinue}
                            >
                              Continue
                              <kbd class="text-[10px] opacity-70">
                                &#8984;&#9166;
                              </kbd>
                            </button>
                          </Show>
                        </div>
                      </div>
                    </div>

                    {/* Right panel — demo (~2/3) */}
                    <div class="flex-1 min-w-0 flex items-center justify-center bg-surface-secondary/30 overflow-hidden">
                      <div style={bodyStyle()} class="w-full h-full">
                        <Show
                          when={lesson().definition.demo}
                          fallback={
                            <div class="flex items-center justify-center h-full">
                              <div class="w-32 opacity-10">
                                <MacroLogo class="fill-ink" />
                              </div>
                            </div>
                          }
                        >
                          {(Demo) => (
                            <Dynamic
                              component={Demo()}
                              onComplete={handleLessonComplete}
                              isActive={true}
                            />
                          )}
                        </Show>
                      </div>
                    </div>
                  </>
                )}
              </Show>
            </div>
          </ClippedPanel>
        </div>
      </div>
    </>
  );
}
