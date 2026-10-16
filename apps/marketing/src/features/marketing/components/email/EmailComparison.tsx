import { emailComparisons } from '../../core/feature-comparisons';
import { FeatureComparisons } from '../comparisons/FeatureComparisons';

export function EmailComparison() {
  return <FeatureComparisons comparisons={emailComparisons} />;
}
