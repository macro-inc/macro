import { createContext, type ParentProps, useContext } from 'solid-js';
import type { createOnboardingState } from './create-onboarding-state';
import type { LessonContentProps, LessonId } from './types';

type OnboardingState = ReturnType<typeof createOnboardingState>;

export interface OnboardingContextValue {
  state: OnboardingState;
  scopeId: string;
  testMode: boolean;
  readyToContinue: () => boolean;
  continueLabel: () => string | undefined;
  setContinueButtonRef: (el: HTMLButtonElement) => void;
  handleLessonComplete: LessonContentProps['onComplete'];
  handleLessonUnready: LessonContentProps['onUnready'];
  advanceLesson: LessonContentProps['advance'];
  handleSkipLesson: () => void;
  handleContinue: () => void;
  resetTutorial: () => void;
  getPreviousLesson: () => LessonId | undefined;
  handleBack: (targetLesson: LessonId) => void;
}

const OnboardingContext = createContext<OnboardingContextValue>();

export function OnboardingProvider(
  props: ParentProps<{ value: OnboardingContextValue }>
) {
  return (
    <OnboardingContext.Provider value={props.value}>
      {props.children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
