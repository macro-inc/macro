import { onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

function WelcomeContent(props: LessonContentProps) {
  onMount(() => props.onComplete('Get Started'));

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        Macro is a unified system for work – built for <strong>speed</strong>{' '}
        and <strong>focus</strong>. This short walk-through will introduce a few
        core features.
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
