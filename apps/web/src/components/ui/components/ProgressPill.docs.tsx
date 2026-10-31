import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { Button } from './Button';
import { ProgressPill } from './ProgressPill';

// #region demo:states
function StatesDemo() {
  return (
    <div class="flex flex-wrap items-center gap-3">
      <ProgressPill value={0} max={0} label="No tasks" />
      <ProgressPill value={0} max={4} label="Tasks not started" />
      <ProgressPill value={2} max={4} label="Tasks in progress" />
      <ProgressPill value={4} max={4} label="Tasks complete" />
    </div>
  );
}
// #endregion

// #region demo:reactive
function ReactiveDemo() {
  const [completed, setCompleted] = createSignal(1);
  return (
    <div class="flex items-center gap-3">
      <ProgressPill value={completed()} max={4} label="Tasks completed" />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setCompleted((count) => (count + 1) % 5)}
      >
        Complete next task
      </Button>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'ProgressPill',
  category: 'Data Display',
  description:
    'A compact, non-interactive completed/total property. The ring fills clockwise; zero totals show an empty ring.',
  status: 'stable',
  exports: ['ProgressPill', 'ProgressRing'],
  import: "import { ProgressPill, ProgressRing } from '@ui';",
  propTypes: ['ProgressPillProps', 'ProgressRingProps'],
  demos: [
    { id: 'states', title: 'Empty, partial, and complete', render: StatesDemo },
    { id: 'reactive', title: 'Reactive progress', render: ReactiveDemo },
  ],
});
