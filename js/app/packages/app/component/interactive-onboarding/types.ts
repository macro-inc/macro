import type { Component } from 'solid-js';

export type LessonId = string;

export interface LessonDefinition {
  id: LessonId;
  title: string;
  description: string;
  content: Component<LessonContentProps>;
  /** Optional component rendered in the right demo panel. When omitted the Macro logo is shown. */
  demo?: Component<LessonContentProps>;
  order?: number;
}

export interface LessonContentProps {
  /** Call when the user has demonstrated understanding */
  onComplete: () => void;
  /** Whether this lesson is currently visible */
  isActive: boolean;
}

export interface LessonState {
  definition: LessonDefinition;
  completed: boolean;
  skipped: boolean;
}
