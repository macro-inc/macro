import { PlanComparison } from '../components/plan-comparison';
import { useOnboardingContext } from '../context/onboarding-context';

/** Load prices only for the below-fold comparison; pending data never suspends setup. */
export function PlanComparisonView(props: {
  disabled: boolean;
  onContinueFree: () => void;
  onBackToPro: () => void;
  onStartMax: () => void;
}) {
  const plans = useOnboardingContext().createPlanCatalog();
  return (
    <PlanComparison
      {...props}
      catalog={plans.catalog()}
      onRetry={plans.retry}
    />
  );
}
