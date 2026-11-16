import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { Button } from './Button';
import { ProgressPill, ProgressRing } from './ProgressPill';

// #region demo:states
function StatesDemo() {
  return (
    <div class="flex flex-wrap items-center gap-3">
      <ProgressPill value={0} max={0} label="No tasks" />
      <ProgressPill value={0} max={4} label="0 of 4 done" />
      <ProgressPill value={2} max={4} label="2 of 4 done" />
      <ProgressPill value={4} max={4} label="All done" />
    </div>
  );
}
// #endregion

// #region demo:reactive
function ReactiveDemo() {
  const [completed, setCompleted] = createSignal(1);
  return (
    <div class="flex items-center gap-3">
      <ProgressPill
        value={completed()}
        max={4}
        label={completed() === 4 ? 'All done' : `${completed()} of 4 done`}
      />
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

// #region demo:rings
function RingSizesDemo() {
  return (
    <div class="flex items-center gap-3">
      <ProgressRing fraction={0.4} size="sm" />
      <ProgressRing fraction={0.4} />
      <ProgressRing fraction={0.4} size="lg" />
    </div>
  );
}
// #endregion
export default defineDoc({
  name: 'ProgressPill',
  category: 'Data Display',
  description:
    'A compact, borderless property with caller-supplied progress text and a 12px ring. Standalone rings default to 16px, with a 44px option for playback controls; zero totals show an empty ring.',
  status: 'stable',
  exports: ['ProgressPill', 'ProgressRing'],
  import: "import { ProgressPill, ProgressRing } from '@ui';",
  propTypes: ['ProgressPillProps', 'ProgressRingProps'],
  demos: [
    { id: 'states', title: 'Empty, partial, and complete', render: StatesDemo },
    { id: 'reactive', title: 'Reactive progress', render: ReactiveDemo },
    { id: 'rings', title: 'Ring sizes', render: RingSizesDemo },
  ],
});
