import { taskComparisons } from '../../core/feature-comparisons';
import { FeatureComparisons } from '../comparisons/FeatureComparisons';

export function TasksComparison() {
  return (
    <FeatureComparisons
      title="Compare Task Managers"
      comparisons={taskComparisons}
    />
  );
}
