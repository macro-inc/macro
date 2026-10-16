import { defineDoc } from '@app/features/ui-gallery/types';
import TrashIcon from '@phosphor/trash.svg';
import { createSignal } from 'solid-js';
import { HoldButton } from './HoldButton';

// #region demo:hold
function HoldDemo() {
  const [confirmed, setConfirmed] = createSignal(0);
  return (
    <div class="flex items-center gap-3">
      <HoldButton
        variant="danger"
        duration={2000}
        onConfirm={() => setConfirmed((count) => count + 1)}
      >
        <TrashIcon />
        Hold to delete
      </HoldButton>
      <span class="text-sm text-ink-muted">Confirmed {confirmed()} times</span>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'HoldButton',
  category: 'Actions',
  description:
    'A Button that runs onConfirm only after it is held down for `duration` milliseconds. A fill sweeps across while held; releasing early resets it. Space and Enter can be held too.',
  status: 'stable',
  exports: ['HoldButton'],
  import: "import { HoldButton } from '@ui';",
  demos: [{ id: 'hold', title: 'Hold to confirm', render: HoldDemo }],
});
