import { crmComparisons } from '../../core/feature-comparisons';
import { FeatureComparisons } from '../comparisons/FeatureComparisons';

export function CrmComparison() {
  return (
    <FeatureComparisons title="Compare CRMs" comparisons={crmComparisons} />
  );
}
