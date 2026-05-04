import { onMount } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import AppStoreQr from '@macro-icons/app-store.svg';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useAnalytics } from '@app/component/analytics-context';
import { useUserId } from '@core/context/user';
import { ENABLE_APP_STORE_QR_CODE } from '@core/constant/featureFlags';
import {
  SIGNUP_LEAD_VALUE_BY_TIER,
  SIGNUP_LEAD_VALUE_DEFAULT,
} from '@app/lib/analytics/leadValues';

function LaunchContent(props: LessonContentProps) {
  const analytics = useAnalytics();
  const [searchParams] = useSearchParams();
  const userId = useUserId();

  onMount(() => {
    // `type` is set on the Stripe success redirect (see choose-plan.tsx). Free
    // users skip Stripe entirely so the param is absent — default to 'free'.
    const rawTier = searchParams.type;
    const tier = (Array.isArray(rawTier) ? rawTier[0] : rawTier) ?? 'free';
    const value = SIGNUP_LEAD_VALUE_BY_TIER[tier] ?? SIGNUP_LEAD_VALUE_DEFAULT;
    analytics.trackMeta('CompleteRegistration', {
      content_name: 'onboarding_launch',
      content_category: tier,
      value,
      currency: 'USD',
    });
    analytics.trackGoogleConversion('signup', {
      value,
      currency: 'USD',
      transaction_id: userId(),
    });
    setTimeout(() => props.onComplete('Launch'));
  });

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      {ENABLE_APP_STORE_QR_CODE ? (
        <>
          <p>You're all set!</p>
          <p>Before you dive in, you can also install our mobile iOS app.</p>
          <p>This QR code is always accessible from the settings panel.</p>
        </>
      ) : (
        <p>You're all set! Let's dive in.</p>
      )}
    </div>
  );
}

function LaunchDemo() {
  return (
    <div class="h-full w-full flex items-center justify-center px-8 @container">
      <div class="h-full w-full flex flex-col items-center justify-center gap-6">
        <AppStoreQr class="w-[50cqw] h-[50cqw]" />
        <p class="text-ink font-medium text-center">
          Download on the
          <br />
          <a
            href="https://apps.apple.com/us/app/macro-app/id6743133649"
            rel="noopener noreferrer"
            class="underline"
            target="_blank"
          >
            App Store
          </a>
        </p>
      </div>
    </div>
  );
}

export const launchLesson: LessonDefinition = {
  id: 'launch',
  title: 'Welcome to Macro',
  content: LaunchContent,
  ...(ENABLE_APP_STORE_QR_CODE && { demo: LaunchDemo, centeredButton: true }),
  order: 100,
};
