import { OnboardingShell } from '../components/onboarding-shell';
import { StepFallback } from '../components/step-fallback';

/**
 * The onboarding frame while the session is still resolving, so a Google
 * sign-up return reads as one screen into onboarding instead of flashing the
 * signed-out slides first.
 */
export function OnboardingPendingView() {
  return (
    <OnboardingShell wide>
      <StepFallback />
    </OnboardingShell>
  );
}
