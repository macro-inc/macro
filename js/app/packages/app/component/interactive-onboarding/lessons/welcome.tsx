import { onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

function WelcomeContent(props: LessonContentProps) {
  onMount(() => props.onComplete('Get Started'));

  return (
    <div class="flex flex-col gap-3">
      <p
        class="text-base text-ink"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 50ms both' }}
      >
        Macro is a powerful, keyboard-first workspace.{' '}
      </p>
      <p
        class="text-base text-ink"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 100ms both' }}
      >
        This short tutorial will take you through a few core interactions. Each
        step only takes a few seconds.
      </p>
    </div>
  );
}

export const welcomeLesson: LessonDefinition = {
  id: 'welcome',
  title: 'Welcome to Macro',
  content: WelcomeContent,
  order: 0,
};
