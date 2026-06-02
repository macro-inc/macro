import { globalSplitManager } from '@app/signal/splitLayout';
import MacroLogo from '@core/component/MacroLogo';
import { isMobile } from '@core/mobile/isMobile';
import LogoIcon from '@icon/macro-logo.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CloseIcon from '@phosphor/x.svg';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { Button, Dialog, Hotkey } from '@ui';
import { type Component, createSignal, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import InteractiveOnboarding from './InteractiveOnboarding';
import { OnboardingProgress } from './OnboardingProgress';
import { useOnboarding } from './onboarding-context';
import type { LessonContentProps, LessonState } from './types';

interface InteractiveOnboardingModalProps {
  open?: boolean;
  defaultOpen?: boolean;
  isFirstTimeOnboarding?: boolean;
  onOpenChange?: (open: boolean) => void;
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

function DemoFallback() {
  return (
    <div class="flex items-center justify-center h-full">
      <div class="w-full m-12 opacity-10 max-w-80">
        <MacroLogo class="fill-ink" />
      </div>
    </div>
  );
}

type ModalPhase = 'start' | 'lessons' | 'end';

function ModalHeader() {
  return (
    <div class="shrink-0 flex items-center justify-between gap-4">
      <Dialog.CloseButton
        as={Button}
        variant="ghost"
        size="icon-sm"
        class="ml-auto"
      >
        <CloseIcon class="size-4" />
      </Dialog.CloseButton>
    </div>
  );
}

function StartScreen(props: { onStart: () => void; onSkip: () => void }) {
  return (
    <div class="flex-1 flex items-center justify-center px-6">
      <div class="max-w-2xl flex flex-col items-center text-center gap-5 onboarding-stagger">
        <LogoIcon class="size-16 text-accent" />
        <Show
          when={!isMobile()}
          fallback={
            <>
              <div class="flex flex-col gap-2">
                <h3 class="text-3xl font-semibold text-ink">
                  Tutorial unavailable on mobile
                </h3>
                <p class="text-base text-ink/60 text-balance">
                  Try the tutorial on web for the best interactive experience.
                </p>
              </div>
              <div class="w-full max-w-xs flex flex-col gap-2 pt-2">
                <Button variant="cta" size="lg" onClick={props.onSkip}>
                  Continue
                  <ArrowRightIcon />
                </Button>
              </div>
            </>
          }
        >
          <div class="flex flex-col gap-2">
            <h3 class="text-3xl font-semibold text-ink">Welcome to Macro</h3>
            <p class="text-base text-ink/60 text-balance">
              Take a quick tour of Macro’s core features.
            </p>
          </div>
          <div class="w-full max-w-xs flex flex-col gap-2 pt-2">
            <Button variant="cta" size="lg" onClick={props.onStart}>
              Play tutorial
              <ArrowRightIcon />
            </Button>
            <Button variant="ghost" size="lg" onClick={props.onSkip}>
              Skip tutorial
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}

function EndScreen(props: { onFinish: () => void; onReplay: () => void }) {
  return (
    <div class="flex-1 flex items-center justify-center px-6">
      <div class="max-w-xl flex flex-col items-center text-center gap-5 onboarding-stagger">
        <LogoIcon class="size-16 text-accent" />
        <div class="flex flex-col gap-2">
          <h3 class="text-3xl font-semibold text-ink">You’re ready to go</h3>
          <p class="text-base text-ink/60 text-balance">
            You can revisit these lessons anytime if you want a refresher.
          </p>
        </div>
        <div class="w-full max-w-xs flex flex-col gap-2 pt-2">
          <Button variant="cta" size="lg" onClick={props.onFinish}>
            Let’s go
            <ArrowRightIcon />
          </Button>
          <Button variant="ghost" size="lg" onClick={props.onReplay}>
            Replay tutorial
          </Button>
        </div>
      </div>
    </div>
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
            variant="ghost"
            size="lg"
            onClick={onboarding.handleSkipLesson}
          >
            Skip lesson
          </Button>
          <Button
            ref={onboarding.setContinueButtonRef}
            variant="cta"
            size="lg"
            onClick={onboarding.handleContinue}
            disabled={!onboarding.readyToContinue()}
          >
            {onboarding.continueLabel() ?? 'Continue'}
            <Hotkey shortcut="cmd+enter" />
          </Button>
        </div>
      </Show>
    </footer>
  );
}

function LessonsScreen(props: { onFinish: () => void; onReplay: () => void }) {
  const onboarding = useOnboarding();
  const lesson = () => onboarding.state.currentLesson();
  const bodyStyle = () => ({
    animation: 'onboarding-fade-up 300ms ease-out both',
  });

  return (
    <Show
      when={lesson()}
      fallback={
        <EndScreen onFinish={props.onFinish} onReplay={props.onReplay} />
      }
    >
      {(currentLesson) => (
        <>
          <div class="flex-1 min-h-0 flex gap-12">
            <aside class="w-105 shrink-0 flex flex-col">
              <div class="flex-1 overflow-y-auto p-4">
                <div style={bodyStyle()}>
                  <div class="bg-ink text-surface text-xs font-mono size-4 flex items-center justify-center font-bold rounded-xs mb-8">
                    {currentLesson().index + 1}
                  </div>
                  <h3 class="text-3xl font-semibold text-ink-muted">
                    {currentLesson().definition.title}
                  </h3>
                  <Show when={currentLesson().definition.subtitle}>
                    <p class="text-sm text-ink/60 mt-4">
                      {currentLesson().definition.subtitle}
                    </p>
                  </Show>
                  <div class="mt-5">
                    <LessonContent
                      lesson={currentLesson()}
                      component={currentLesson().definition.content}
                    />
                  </div>
                </div>
              </div>
            </aside>

            <main class="flex-1 min-w-0 flex flex-col bg-surface-secondary/30">
              <div class="flex-1 min-h-0 overflow-hidden">
                <div style={bodyStyle()} class="size-full">
                  <Show
                    when={currentLesson().definition.demo}
                    fallback={<DemoFallback />}
                  >
                    {(Demo) => (
                      <LessonContent
                        lesson={currentLesson()}
                        component={Demo()}
                      />
                    )}
                  </Show>
                </div>
              </div>
            </main>
          </div>
          <ModalFooter lesson={currentLesson()} />
        </>
      )}
    </Show>
  );
}

function InteractiveOnboardingModalLayout(props: {
  isFirstTimeOnboarding: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = createSignal<ModalPhase>('start');
  const onboarding = useOnboarding();

  const handleSkip = () => {
    props.onClose();
  };

  const handleReplay = () => {
    onboarding.resetTutorial();
    setPhase('lessons');
  };

  return (
    <div class="size-full flex flex-col gap-4 bg-surface text-ink">
      <ModalHeader />
      <Switch>
        <Match when={phase() === 'start'}>
          <StartScreen
            onStart={() => setPhase('lessons')}
            onSkip={handleSkip}
          />
        </Match>
        <Match when={phase() === 'end' || onboarding.state.isFinished()}>
          <EndScreen onFinish={props.onClose} onReplay={handleReplay} />
        </Match>
        <Match when={true}>
          <LessonsScreen onFinish={props.onClose} onReplay={handleReplay} />
        </Match>
      </Switch>
    </div>
  );
}

export function InteractiveOnboardingModal(
  props: InteractiveOnboardingModalProps
) {
  const [internalOpen, setInternalOpen] = createSignal(
    props.defaultOpen ?? false
  );
  const completeTutorial = useCompleteTutorialMutation();

  const open = () => props.open ?? internalOpen();

  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      completeTutorial.mutate(undefined);
    }
    setInternalOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  };

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      position="center"
      // Let the shell keep the focus it grabs in onMount (keeps its scope active).
      onOpenAutoFocus={(e) => e.preventDefault()}
      // Auto-opened on login, so Kobalte has nothing to restore to: return
      // focus to the active split so the app stays keyboard-usable on close.
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        globalSplitManager()?.returnFocus();
      }}
      class="w-[min(1600px,calc(100vw-32px))] h-[min(900px,calc(100vh-32px))] max-w-none rounded-xl bg-surface shadow-2xl"
    >
      <div class="relative size-full overflow-hidden rounded-xl flex flex-col">
        <Show when={open()}>
          <InteractiveOnboarding
            onDismiss={() => setOpen(false)}
            ignoreTutorialCompleted
            isFirstTimeOnboarding={props.isFirstTimeOnboarding}
          >
            <InteractiveOnboardingModalLayout
              isFirstTimeOnboarding={props.isFirstTimeOnboarding === true}
              onClose={() => setOpen(false)}
            />
          </InteractiveOnboarding>
        </Show>
      </div>
    </Dialog>
  );
}
