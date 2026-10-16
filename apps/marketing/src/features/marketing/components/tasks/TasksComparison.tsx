import { taskComparisons } from '../../core/feature-comparisons';
import { FeatureComparisons } from '../comparisons/FeatureComparisons';

export function TasksComparison() {
  return <FeatureComparisons comparisons={taskComparisons} />;
}
