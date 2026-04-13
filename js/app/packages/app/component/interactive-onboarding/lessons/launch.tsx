import { onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

function LaunchContent(props: LessonContentProps) {
  onMount(() => setTimeout(() => props.onComplete('Launch')));

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>You're all set! Let's dive in.</p>
    </div>
  );
}

export const launchLesson: LessonDefinition = {
  id: 'launch',
  title: 'Welcome to Macro',
  content: LaunchContent,
  order: 100,
};
