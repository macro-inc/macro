import { onMount } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';

function TempPaywallContent(props: LessonContentProps) {
  onMount(() => props.onComplete());

  return (
    <div class="flex flex-col gap-3">
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 50ms both' }}
      >
        Choose a plan to get started.
      </p>
    </div>
  );
}

function TempPaywallDemo() {
  return (
    <div class="flex items-center justify-center h-full">
      <p class="text-4xl font-bold text-ink/20">TEMP PAYWALL</p>
    </div>
  );
}

export const choosePlanLesson: LessonDefinition = {
  id: 'temp-paywall',
  title: 'Choose your plan',
  content: TempPaywallContent,
  demo: TempPaywallDemo,
  order: 80,
};
