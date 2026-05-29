import { useAnalytics } from '@app/component/analytics-context';
import { CommandState } from '@app/component/command';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { useIsAuthenticated } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { useTutorialCompleted } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fetchToken } from '@core/util/fetchWithToken';
import { useSendMobileWelcomeEmail } from '@queries/auth';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useLocation, useNavigate } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createOnboardingState } from './create-onboarding-state';
import { LESSONS } from './lessons';
import { commandKOpen, setCommandKOpen } from './lessons/command-k';
import MobileWebSignupSent from './MobileWebSignupSent';
import MobileWebWelcome from './MobileWebWelcome';
import { OnboardingProvider } from './onboarding-context';
import { resetSandbox } from './sandbox/sandbox-store';

interface InteractiveOnboardingProps {
  onDismiss?: () => void;
  ignoreTutorialCompleted?: boolean;
  children: JSX.Element;
}

export default function InteractiveOnboarding(
  props: InteractiveOnboardingProps
) {
  const isAuthenticated = useIsAuthenticated();
  const [mobileWebStep, setMobileWebStep] = createSignal<
    'welcome' | 'signup-sent'
  >('welcome');
  const [submittedEmail, setSubmittedEmail] = createSignal<string | undefined>(
    undefined
  );
  const sendMobileWelcomeEmail = useSendMobileWelcomeEmail();

  // Mobile web users who aren't authenticated get a dedicated welcome screen
  // with email signup instead of the full lesson flow.
  const isMobileWeb = isTouchDevice() && !isNativeMobilePlatform();

  const handleMobileSignUp = async (email: string) => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.failure('Invalid email address.');
      return;
    }

    const result = await sendMobileWelcomeEmail.mutateAsync(email);

    if (result.isOk()) {
      if (result.value.sent) {
        setSubmittedEmail(email);
        setMobileWebStep('signup-sent');
      } else {
        toast.alert('Email already sent.');
      }
    } else {
      const code = result.error?.[0]?.code;
      if (code === 'RATE_LIMITED') {
        toast.failure('Rate limit exceeded.');
      } else if (code === 'INVALID_EMAIL') {
        toast.failure('Invalid email address.');
      } else {
        toast.failure('Internal error. Please try again.');
      }
    }
  };

  return (
    <Show
      when={!isMobileWeb || isAuthenticated() === true}
      fallback={
        <Show
          when={mobileWebStep() === 'welcome'}
          fallback={<MobileWebSignupSent email={submittedEmail()} />}
        >
          <MobileWebWelcome onSignUp={handleMobileSignUp} />
        </Show>
      }
    >
      <InteractiveOnboardingInner
        onDismiss={props.onDismiss}
        ignoreTutorialCompleted={props.ignoreTutorialCompleted}
      >
        {props.children}
      </InteractiveOnboardingInner>
    </Show>
  );
}

function InteractiveOnboardingInner(props: InteractiveOnboardingProps) {
  const analytics = useAnalytics();

  const splitPanel = useSplitPanel();
  const completeTutorial = useCompleteTutorialMutation();
  const tutorialCompleted = useTutorialCompleted();
  const location = useLocation();

  const isTouch = isTouchDevice();

  const lessons = createMemo(() => LESSONS);

  const testMode = new URLSearchParams(location.search).has('test');

  const params = new URLSearchParams(location.search);
  const slideParam = params.get('slide');
  const slideIndex =
    slideParam !== null ? Math.max(0, parseInt(slideParam, 10) - 1) : null;

  const sortedLessons = createMemo(() =>
    [...lessons()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  );
  const debugCompleted =
    slideIndex !== null
      ? new Set(
          sortedLessons()
            .slice(0, slideIndex)
            .map((l) => l.id)
        )
      : undefined;

  // Detect a return-from-external-flow param synchronously so we can pre-populate
  // completed lessons before the first render, avoiding a flash of the first slide.
  // Search the unfiltered LESSONS list so return params can still complete
  // lessons even if the visible lesson list changes.
  const returningLesson = LESSONS.findLast(
    (l) => l.completeOnParam && params.has(l.completeOnParam)
  );
  const returnCompleted = returningLesson
    ? new Set(
        sortedLessons()
          .filter((l) => (l.order ?? 0) <= (returningLesson.order ?? 0))
          .map((l) => l.id)
      )
    : undefined;

  const state = createOnboardingState({
    definitions: lessons,
    initialCompleted: debugCompleted ?? returnCompleted ?? new Set(),
  });

  const [readyToContinue, setReadyToContinue] = createSignal(false);
  const [continueLabel, setContinueLabel] = createSignal<string | undefined>(
    undefined
  );

  const navigate = useNavigate();

  const navigateAway = () => {
    if (props.onDismiss) {
      props.onDismiss();
    } else if (splitPanel) {
      splitPanel.handle.replace({
        next: { type: 'component', id: 'unified-list' },
      });
    } else {
      navigate('/', { replace: true });
    }
  };

  // Redirect away if the backend already marks the tutorial as complete.
  // Skip the redirect when returning from external flow — we just marked it
  // complete ourselves and still have remaining lessons to show.
  createEffect(() => {
    if (
      tutorialCompleted() &&
      !props.ignoreTutorialCompleted &&
      !returningLesson &&
      !testMode
    ) {
      navigateAway();
    }
  });

  let continueButtonRef: HTMLButtonElement | undefined;

  const handleLessonComplete = (
    buttonLabel?: string,
    options?: { skipFocus?: boolean }
  ) => {
    setContinueLabel(buttonLabel);
    setReadyToContinue(true);
    // Skip auto-focus on touch — Safari scrolls to the focused element,
    // which jumps the view to the bottom on longer lessons.
    if (!isTouch && !options?.skipFocus) {
      requestAnimationFrame(() => continueButtonRef?.focus());
    }
  };

  const handleLessonUnready = () => {
    setReadyToContinue(false);
  };

  // Programmatic advance for lessons that progress on their own interaction
  // (e.g. clicking a plan card) rather than the Continue button.
  const advanceLesson = () => {
    const current = state.currentLesson();
    if (!current) return;
    analytics.track(
      `onboarding_step_${current.definition.id.replaceAll('-', '_')}`,
      {
        id: current.definition.id,
        index: current.index,
        state: 'completed',
      }
    );
    state.completeLesson(current.definition.id);
    setReadyToContinue(false);
    setContinueLabel(undefined);
  };

  const handleSkipLesson = () => {
    const current = state.currentLesson();
    if (!current) return;

    analytics.track(
      `onboarding_step_${current.definition.id.replaceAll('-', '_')}`,
      {
        id: current.definition.id,
        index: current.index,
        state: 'skipped',
      }
    );

    state.skipLesson(current.definition.id);
    setReadyToContinue(false);
    setContinueLabel(undefined);
  };

  const handleContinue = () => {
    const current = state.currentLesson();
    if (!current || !readyToContinue()) return;

    analytics.track(
      `onboarding_step_${current.definition.id.replaceAll('-', '_')}`,
      {
        id: current.definition.id,
        index: current.index,
        state: 'completed',
      }
    );

    if (current.definition.onContinue) {
      // On web this redirects (returns void). On native mobile it resolves
      // with true after inline auth succeeds, so we advance the lesson.
      const result = current.definition.onContinue();
      if (result instanceof Promise) {
        result.then((shouldAdvance) => {
          if (shouldAdvance) {
            state.completeLesson(current.definition.id);
            setReadyToContinue(false);
            setContinueLabel(undefined);
          }
        });
      }
      return;
    }

    state.completeLesson(current.definition.id);
    setReadyToContinue(false);
    setContinueLabel(undefined);
  };

  const getBackContext = () => ({
    isLessonSkipped: (id: string) =>
      state.lessons().find((l) => l.definition.id === id)?.skipped ?? false,
    hasPaidAccess: false,
  });

  const getPreviousLesson = () => {
    const current = state.currentLesson();
    if (!current) return undefined;
    const prev = current.definition.previousLesson;
    if (!prev) return undefined;
    if (typeof prev === 'function') {
      return prev(getBackContext());
    }
    return prev;
  };

  const handleBack = (targetLesson: string) => {
    const current = state.currentLesson();
    if (!current) return;
    const onBack = current.definition.onBack;
    if (onBack) {
      onBack(getBackContext());
    }
    state.goToLessonById(targetLesson);
  };

  // cmd+enter hotkey to continue
  let shellRef: HTMLDivElement | undefined;
  // Detached so onboarding hotkeys do not bubble up to app/global hotkeys.
  // Any lesson hotkeys registered with this scope still work while this shell
  // is focused, but unhandled keys stop at this scope instead of falling back
  // to the app-level handlers.
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('onboarding-shell', true);

  onMount(() => {
    if (shellRef) {
      attachHotkeys(shellRef);
      shellRef.focus();

      // Keep raw bubbling keyboard events inside onboarding without blocking
      // target-level handlers like Lexical's editor input/mentions handling.
      // App-level hotkeys are handled separately by the detached hotkey scope.
      const stopKeyboardPropagation = (event: KeyboardEvent) => {
        event.stopPropagation();
      };
      shellRef.addEventListener('keydown', stopKeyboardPropagation);
      shellRef.addEventListener('keyup', stopKeyboardPropagation);
      onCleanup(() => {
        shellRef?.removeEventListener('keydown', stopKeyboardPropagation);
        shellRef?.removeEventListener('keyup', stopKeyboardPropagation);
      });
    }

    // When returning from an external flow, clean the return param from the URL
    // and run side-effects. The lessons are already pre-completed synchronously.
    if (returningLesson?.completeOnParam) {
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete(returningLesson.completeOnParam);
      const qs = cleanParams.toString();
      window.history.replaceState(
        null,
        '',
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      );

      // Ensure the JWT is refreshed before making authenticated API calls.
      // On a fresh page load after OAuth redirect, the session cookie is set
      // but no fetchWithToken call has triggered a token refresh yet.
      if (returningLesson.onCompleteParam) {
        fetchToken().then(() => returningLesson.onCompleteParam!());
      }
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
        }
      }
    )
  );

  onMount(() => {
    if (state.currentIndex() > 0) return;

    analytics.track('onboarding_start', {
      source:
        params.get('mobile_welcome_email') === 'true'
          ? 'mobile_welcome_email'
          : undefined,
    });
  });

  createEffect(
    on(
      () => state.currentLesson(),
      (lesson) => {
        if (!lesson) return;

        analytics.track(
          `onboarding_step_${lesson.definition.id.replaceAll('-', '_')}`,
          {
            id: lesson.definition.id,
            index: lesson.index,
            state: 'viewed',
          }
        );
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

  const setContinueButtonRef = (el: HTMLButtonElement) => {
    continueButtonRef = el;
  };

  const contextValue = {
    state,
    scopeId,
    testMode,
    readyToContinue,
    continueLabel,
    setContinueButtonRef,
    handleLessonComplete,
    handleLessonUnready,
    advanceLesson,
    handleSkipLesson,
    handleContinue,
    getPreviousLesson,
    handleBack,
  };

  return (
    <OnboardingProvider value={contextValue}>
      <div
        ref={shellRef}
        class="flex items-center justify-center size-full p-3 sm:p-4 overflow-hidden relative"
        tabIndex={-1}
      >
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

        <div class="size-full max-w-400 max-h-225 flex">{props.children}</div>
      </div>
    </OnboardingProvider>
  );
}
