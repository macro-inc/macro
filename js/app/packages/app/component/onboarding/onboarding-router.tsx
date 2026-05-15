import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { ENABLE_NEW_ONBOARDING_OVERRIDE } from '@core/constant/featureFlags';
import { lazy, Show, Suspense } from 'solid-js';

const NewOnboarding = lazy(() => import('./onboarding'));
const OldOnboarding = lazy(
  () => import('../interactive-onboarding/InteractiveOnboarding')
);

export default function OnboardingRouter() {
  const flag = useFeatureFlag('enable-new-onboarding', {
    enabledOverride: ENABLE_NEW_ONBOARDING_OVERRIDE,
  });

  return (
    <Suspense>
      <Show when={flag().enabled} fallback={<OldOnboarding />}>
        <NewOnboarding />
      </Show>
    </Suspense>
  );
}
