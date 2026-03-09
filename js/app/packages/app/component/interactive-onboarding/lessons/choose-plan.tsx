import { useHasPaidAccess } from '@core/auth';
import { onMount } from 'solid-js';
import PaywallComponent from '../../paywall/PaywallComponent';
import type { LessonContentProps, LessonDefinition } from '../types';

function ChoosePlanContent(props: LessonContentProps) {
  const hasPaid = useHasPaidAccess();

  onMount(() => {
    if (hasPaid()) {
      props.onComplete();
    }
  });

  return (
    <div class="flex flex-col gap-3">
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 50ms both' }}
      >
        Choose a plan to get started. You can always change this later.
      </p>
    </div>
  );
}

function ChoosePlanDemo(props: LessonContentProps) {
  return (
    <div class="flex items-center justify-center h-full overflow-y-auto px-4 py-6">
      <PaywallComponent
        cb={() => {}}
        handleGuest={() => props.onComplete()}
        hideCloseButton
        isOnboarding
      />
    </div>
  );
}

export const choosePlanLesson: LessonDefinition = {
  id: 'choose-plan',
  title: 'Choose your plan',
  description: 'Pick the plan that works for you.',
  content: ChoosePlanContent,
  demo: ChoosePlanDemo,
  order: 20,
};
