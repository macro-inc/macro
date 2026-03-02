import { For } from 'solid-js';
import { cn } from '@ui/utils/classname';
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
            class={cn('size-4 border border-edge-muted', {
              'border-edge pattern pattern-edge pattern-diagonal-4':
                i() === props.currentIndex,
              'border-edge bg-edge':
                lesson.completed || i() < props.currentIndex,
            })}
          />
        )}
      </For>
    </div>
  );
}
