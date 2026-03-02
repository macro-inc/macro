import { onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

function WelcomeContent(props: LessonContentProps) {
  onMount(() => props.onComplete());

  return (
    <div class="flex flex-col gap-3">
      <p
        class="text-sm text-ink"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 50ms both' }}
      >
        Macro is a keyboard-first workspace. Everything you need — documents,
        emails, tasks, and channels — lives in a single list you can fly through
        without touching the mouse.
      </p>
      <p
        class="text-sm text-ink"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 150ms both' }}
      >
        This short tutorial will walk you through the core interactions. Each
        step only takes a few seconds.
      </p>
    </div>
  );
}

export const welcomeLesson: LessonDefinition = {
  id: 'welcome',
  title: 'Welcome to Macro',
  description: 'A quick overview of how things work.',
  content: WelcomeContent,
  order: 0,
};
