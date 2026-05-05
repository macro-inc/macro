import type { Component } from 'solid-js';
import type { OnboardingContextValue } from './onboarding-context';

export type LessonId = string;

export interface BackContext {
  onboarding: OnboardingContextValue;
  isLessonSkipped: (id: LessonId) => boolean;
  hasPaidAccess: boolean;
}

export interface LessonDefinition {
  id: LessonId;
  title: string;
  subtitle?: string;
  content: Component<LessonContentProps>;
  /** Optional component rendered in the right demo panel. When omitted the Macro logo is shown. */
  demo?: Component<LessonContentProps>;
  order?: number;
  /** ID of the lesson to navigate back to, or a function that returns it (or undefined to hide the button). When set, a back button appears in the sidebar. */
  previousLesson?: LessonId | ((context: BackContext) => LessonId | undefined);
  /** Called before navigating back, for cleanup/side effects. */
  onBack?: (context: BackContext) => void;
  /** Hide the continue button entirely — the lesson drives its own advancement. */
  hideContinue?: boolean;
  /** Called instead of the default complete-and-advance flow. On web, redirects externally (returns void). On native mobile, performs auth inline and returns true to advance. */
  onContinue?: () => void | Promise<boolean>;
  /** If this URL search param is present on mount, auto-complete this lesson and advance (used for returning from external OAuth flows). */
  completeOnParam?: string;
  /** Called when completeOnParam is detected, before the lesson is advanced. Return false to abort the fast-forward (e.g. when initialization fails). */
  onCompleteParam?: () => Promise<boolean>;
  /** Center the continue button label. */
  centeredButton?: boolean;
  /** Optional secondary button rendered below the continue button. */
  secondaryAction?: Component<LessonContentProps>;
}

export interface LessonContentProps {
  /** Call when the user has demonstrated understanding. Pass a string to customise the "Get Started" button label. Pass skipFocus: true to prevent auto-focusing the continue button. */
  onComplete: (buttonLabel?: string, options?: { skipFocus?: boolean }) => void;
  /** Call to disable the continue button (e.g., when form validation fails). */
  onUnready: () => void;
  /** Whether this lesson is currently visible */
  isActive: boolean;
  /** Hotkey scope ID from the shell — register all lesson hotkeys into this scope */
  scopeId: string;
  /** Programmatically mark the current lesson complete and advance to the next one. */
  advance: () => void;
  /** Skip a specific lesson by ID without navigating to it. */
  skipLesson: (id: LessonId) => void;
  /** Navigate to a specific lesson by ID (un-skips it so it becomes current). */
  goToLesson: (id: LessonId) => void;
}

export interface LessonState {
  definition: LessonDefinition;
  completed: boolean;
  skipped: boolean;
  index: number;
}
