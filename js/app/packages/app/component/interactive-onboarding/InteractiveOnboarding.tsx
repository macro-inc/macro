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
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { CommandState } from '@app/component/command';
import { resetSandbox } from './sandbox/sandbox-store';
import { commandKOpen, setCommandKOpen } from './lessons/command-k';
import { createOnboardingState } from './create-onboarding-state';
import { LESSONS } from './lessons';
import { ContinueButton, SkipButton } from './components-lib';
import { OnboardingProgress } from './OnboardingProgress';
import {
  clearCompletedLessons,
  loadCompletedLessons,
  saveCompletedLesson,
} from './persistence';

import { ClippedPanel } from '@core/component/ClippedPanel';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { useAnalytics } from '@app/component/analytics-context';

export default function InteractiveOnboarding() {
  const analytics = useAnalytics();

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
  const [continueLabel, setContinueLabel] = createSignal<string | undefined>(
    undefined
  );
  const [lessonKey, setLessonKey] = createSignal(0);

  const navigateAway = () => {
    splitPanel?.handle.replace({
      next: { type: 'component', id: 'unified-list' },
    });
  };

  let continueButtonRef: HTMLButtonElement | undefined;

  const handleLessonComplete = (buttonLabel?: string) => {
    setContinueLabel(buttonLabel);
    setReadyToContinue(true);
    requestAnimationFrame(() => continueButtonRef?.focus());
  };

  const handleContinue = () => {
    const current = state.currentLesson();
    if (!current || !readyToContinue()) return;

    analytics.track('onboarding_step', {
      id: current.definition.id,
      index: current.index,
      state: 'completed',
    });

    state.completeLesson(current.definition.id);
    if (!testMode) {
      saveCompletedLesson(current.definition.id);
    }
    setReadyToContinue(false);
    setContinueLabel(undefined);
    setLessonKey((k) => k + 1);
  };

  const handleSkip = () => {
    const current = state.currentLesson();

    if (!current) return;

    analytics.track('onboarding_step', {
      id: current.definition.id,
      index: current.index,
      state: 'skipped',
    });

    state.skipLesson(current.definition.id);

    setReadyToContinue(false);
    setContinueLabel(undefined);
    setLessonKey((k) => k + 1);
  };

  // cmd+enter hotkey to continue
  let shellRef: HTMLDivElement | undefined;
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('onboarding-shell');

  onMount(() => {
    if (shellRef) {
      attachHotkeys(shellRef);
      shellRef.focus();
    }
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

  const skipReg = registerHotkey({
    scopeId,
    hotkey: 'escape',
    description: 'Skip',
    runWithInputFocused: true,
    keyDownHandler: () => {
      if (!state.currentLesson()?.definition.skippable) return false;
      handleSkip();
      return true;
    },
  });

  // Block global cmd+k during the entire tutorial.
  // On the command-k lesson slide this opens/closes the sandbox command menu.
  const cmdkReg = registerHotkey({
    scopeId,
    hotkey: 'cmd+k',
    description: 'Command menu (onboarding)',
    runWithInputFocused: true,
    keyDownHandler: () => {
      setCommandKOpen((v) => !v);
      return true; // swallow — prevents global handler
    },
  });

  // Patch CommandState so the global cmd+k handler (which calls toggle/open)
  // cannot open the real command menu while we're in the tutorial. Instead
  // it drives our sandbox dialog. Also patch close() so escape inside
  // CommandMenuInner closes the sandbox dialog.
  const origToggle = CommandState.toggle.bind(CommandState);
  const origOpen = CommandState.open.bind(CommandState);
  const origClose = CommandState.close.bind(CommandState);

  CommandState.toggle = () => {
    setCommandKOpen((v) => !v);
  };
  CommandState.open = () => {
    setCommandKOpen(true);
  };
  CommandState.close = () => {
    origClose();
    setCommandKOpen(false);
  };

  onCleanup(() => {
    CommandState.toggle = origToggle;
    CommandState.open = origOpen;
    CommandState.close = origClose;
  });
  onCleanup(() => reg.dispose());
  onCleanup(() => skipReg.dispose());
  onCleanup(() => cmdkReg.dispose());
  onCleanup(() => resetSandbox());

  // When the sandbox command menu dialog closes, return focus to the
  // onboarding shell so DOM-scoped hotkeys (including cmd+k) keep working.
  createEffect(
    on(commandKOpen, (open) => {
      if (!open) {
        shellRef?.focus();
      }
    })
  );

  createEffect(
    on(
      () => state.isFinished(),
      (finished) => {
        if (finished && !testMode) {
          analytics.track('onboarding_completed');
          completeTutorial.mutate(undefined);
          navigateAway();
        }
      }
    )
  );

  onMount(() => {
    if (state.currentIndex() > 0) return;

    analytics.track('onboarding_start');
  });

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
    <div
      ref={shellRef}
      class="flex items-center justify-center h-full w-full p-8 overflow-hidden relative"
      tabIndex={-1}
    >
      {/* Scoped keyframes */}
      <style>{
        /*css*/ `
        @keyframes onboarding-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes onboarding-scale-in {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        .onboarding-stagger > * {
          animation: onboarding-fade-up 300ms ease-out both;
        }
        .onboarding-stagger > *:nth-child(1) { animation-delay: 50ms; }
        .onboarding-stagger > *:nth-child(2) { animation-delay: 120ms; }
        .onboarding-stagger > *:nth-child(3) { animation-delay: 190ms; }
        .onboarding-stagger > *:nth-child(4) { animation-delay: 260ms; }
        .onboarding-stagger > *:nth-child(5) { animation-delay: 330ms; }
      `
      }</style>
      <div class="inset-0 absolute text-edge bg-panel opacity-10 -z-1">
        <PcNoiseGrid
          cellSize={30}
          warp={0}
          crunch={0.2}
          freq={0.001}
          size={[0, 0.3]}
          rounding={0}
          fill={0}
          stroke={1}
          speed={[0.017, 0.209]}
        />
      </div>

      {/* Centered card */}
      <div class="size-full max-w-[1600px] max-h-[900px]">
        <ClippedPanel
          cornerRadius={'4px'}
          class="bg-panel size-full shadow-lg shadow-[#1111]"
        >
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
                    <div class="p-4">
                      <div style={headerStyle()}>
                        <div class="bg-ink text-panel text-xs font-mono size-4 flex items-center justify-center font-bold rounded-xs">
                          {lesson().index + 1}
                        </div>
                        <h2 class="text-3xl font-semibold text-ink-muted mt-12">
                          {lesson().definition.title}
                        </h2>
                      </div>
                    </div>

                    {/* Body */}
                    <div class="flex-1 overflow-y-auto px-4 flex flex-col">
                      <div style={bodyStyle()}>
                        <Show when={lesson().definition.subtitle}>
                          <p class="text-sm text-ink/60 mb-4">
                            {lesson().definition.subtitle}
                          </p>
                        </Show>
                        <Dynamic
                          component={lesson().definition.content}
                          onComplete={handleLessonComplete}
                          isActive={true}
                          scopeId={scopeId}
                        />
                      </div>
                      <div class="mt-8 pt-4 flex flex-col gap-2">
                        <ContinueButton
                          ref={(el) => {
                            continueButtonRef = el;
                          }}
                          onClick={handleContinue}
                          label={continueLabel()}
                          ghost={!readyToContinue()}
                        />
                        <Show when={lesson().definition.skippable}>
                          <SkipButton onClick={handleSkip} />
                        </Show>
                      </div>
                    </div>

                    {/* Footer */}
                    <div class="flex flex-col gap-3 px-4 py-3 border-t border-ink/10">
                      <div class="flex items-center justify-between gap-2">
                        <OnboardingProgress
                          lessons={[...state.lessons()]}
                          currentIndex={state.currentIndex()}
                        />
                        <span class="text-xs text-ink-extra-muted/50 font-mono">
                          {state.currentIndex() + 1} / {state.lessons().length}
                        </span>
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
                            <div class="w-full m-12 opacity-10 max-w-80">
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
                            scopeId={scopeId}
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
  );
}
