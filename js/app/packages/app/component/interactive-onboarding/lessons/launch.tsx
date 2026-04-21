import { onMount } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useAnalytics } from '@app/component/analytics-context';

function LaunchContent(props: LessonContentProps) {
  const analytics = useAnalytics();
  const [searchParams] = useSearchParams();

  onMount(() => {
    // `type` is set on the Stripe success redirect (see choose-plan.tsx). Free
    // users skip Stripe entirely so the param is absent — default to 'free'.
    const tier = searchParams.type ?? 'free';
    analytics.trackMeta('CompleteRegistration', {
      content_name: 'onboarding_launch',
      content_category: tier,
    });
    setTimeout(() => props.onComplete('Launch'));
  });

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
