import { defineDoc } from '@app/features/ui-gallery/types';
import { Spinner } from './Spinner';

// #region demo:sizes
function SizesDemo() {
  return (
    <div class="flex items-center gap-6 text-ink-muted">
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
    </div>
  );
}
// #endregion

// #region demo:inline
function InlineDemo() {
  return (
    <div role="status" class="flex items-center gap-2 text-ink-muted">
      <Spinner size="sm" decorative />
      <span>Loading files</span>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Spinner',
  category: 'Feedback',
  description:
    'A current-color loading ring with a quiet track, rounded arc, and reduced-motion support.',
  import: "import { Spinner } from '@ui';",
  demos: [
    { id: 'sizes', title: 'Sizes', render: SizesDemo },
    { id: 'inline', title: 'With loading text', render: InlineDemo },
  ],
  guidelines: {
    do: [
      'Give standalone spinners a label that describes the pending operation.',
      'Use decorative beside loading text or inside an already-labelled control.',
      'Use a progress bar when the amount of work is known.',
    ],
    dont: [
      'Announce the same loading message from both a spinner and its parent.',
      'Add a second spin animation to a spinner or its parent.',
    ],
  },
});
