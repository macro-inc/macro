import { cn } from '@ui';
import { For } from 'solid-js';
import type { LessonState } from './types';

interface OnboardingProgressProps {
  lessons: LessonState[];
  currentIndex: number;
}

export function OnboardingProgress(props: OnboardingProgressProps) {
  return (
    <div class="flex items-center gap-1">
      <For each={props.lessons}>
        {(lesson, i) => (
          <div
            class={cn('size-2 border border-edge-muted rounded-full', {
              'bg-ink/10': lesson.completed,
              'border-edge bg-edge': i() === props.currentIndex,
            })}
          />
        )}
      </For>
    </div>
  );
}
