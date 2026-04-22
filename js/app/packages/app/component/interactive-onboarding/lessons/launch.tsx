import { onMount } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import AppStoreQr from '@macro-icons/app-store.svg';
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
      <p>You're all set!</p>
      <p>Before you dive in, you can also install our mobile iOS app.</p>
      <p>This QR code is always accessible from the settings panel.</p>
    </div>
  );
}

function LaunchDemo() {
  return (
    <div class="h-full w-full flex items-center justify-center px-8 @container">
      <div class="h-full w-full flex flex-col items-center justify-center gap-6">
        <AppStoreQr class="w-[50cqw] h-[50cqw] text-accent" />
        <p class="text-ink font-medium">Download on the App Store</p>
      </div>
    </div>
  );
}

export const launchLesson: LessonDefinition = {
  id: 'launch',
  title: 'Welcome to Macro',
  content: LaunchContent,
  demo: LaunchDemo,
  centeredButton: true,
  order: 100,
};
