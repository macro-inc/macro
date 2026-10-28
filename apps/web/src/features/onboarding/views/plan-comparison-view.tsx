import { PlanComparison } from '../components/plan-comparison';
import { useOnboardingContext } from '../context/onboarding-context';

/** Load prices only for the below-fold comparison; pending data never suspends setup. */
export function PlanComparisonView(props: {
  disabled: boolean;
  onContinueFree: () => void;
  onBackToPro: () => void;
  onStartMax: () => void;
}) {
  const context = useOnboardingContext();
  const plans = context.createPlanCatalog();
  const trial = context.createTrialEligibility();
  const trialEligible = () => {
    const state = trial.eligibility();
    return state.t === 'ready' && state.value;
  };
  return (
    <PlanComparison
      {...props}
      catalog={plans.catalog()}
      trialEligible={trialEligible()}
      existingSubscription={trial.existingSubscription()}
      onRetry={plans.retry}
    />
  );
}
