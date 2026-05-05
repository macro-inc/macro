import { createSignal, onMount, Show } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import AppStoreQr from '@macro-icons/app-store.svg';
import { SegmentedControl } from '@ui';
import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';
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
          <p>
            Before you dive in, install our mobile iOS app or connect Macro to
            your favorite AI tools via MCP.
          </p>
          <p>Both are always accessible from the settings panel.</p>
        </>
      ) : (
        <p>You're all set! Let's dive in.</p>
      )}
    </div>
  );
}

type LaunchTab = 'mobile' | 'mcp';

const LAUNCH_TAB_OPTIONS: Array<{ value: LaunchTab; label: string }> = [
  { value: 'mobile', label: 'Mobile app' },
  { value: 'mcp', label: 'MCP instructions' },
];

function MobilePanel() {
  return (
    <div class="h-full w-full flex flex-col items-center justify-center gap-6">
      <AppStoreQr class="w-[55cqw] h-[55cqw] max-w-[460px] max-h-[460px]" />
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
  );
}

function LaunchDemo() {
  const [tab, setTab] = createSignal<LaunchTab>('mobile');

  return (
    <div class="h-full w-full flex flex-col items-center px-8 py-8 @container">
      <SegmentedControl
        value={tab()}
        options={LAUNCH_TAB_OPTIONS}
        onChange={setTab}
        aria-label="Launch options"
      />
      <div class="flex-1 w-full min-h-0 mt-6 flex items-start justify-center overflow-y-auto">
        <Show when={tab() === 'mobile'} fallback={<McpSetupCards />}>
          <MobilePanel />
        </Show>
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
