import type { Component } from 'solid-js';

export type LessonId = string;

export interface LessonDefinition {
  id: LessonId;
  title: string;
  subtitle?: string;
  content: Component<LessonContentProps>;
  /** Optional component rendered in the right demo panel. When omitted the Macro logo is shown. */
  demo?: Component<LessonContentProps>;
  order?: number;
  /** Whether the user can skip this lesson. Defaults to false. */
  skippable?: boolean;
  /** Hide the continue/skip buttons entirely — the lesson drives its own advancement. */
  hideContinue?: boolean;
}

export interface LessonContentProps {
  /** Call when the user has demonstrated understanding. Pass a string to customise the "Get Started" button label. */
  onComplete: (buttonLabel?: string) => void;
  /** Whether this lesson is currently visible */
  isActive: boolean;
  /** Hotkey scope ID from the shell — register all lesson hotkeys into this scope */
  scopeId: string;
}

export interface LessonState {
  definition: LessonDefinition;
  completed: boolean;
  skipped: boolean;
  index: number;
}
