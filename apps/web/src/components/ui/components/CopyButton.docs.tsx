import { defineDoc } from '@app/features/ui-gallery/types';
import CopyIcon from '@icon/system/regular/copy.svg';
import { For } from 'solid-js';
import { CopyButton } from './CopyButton';

// #region demo:variants
function VariantsDemo() {
  return (
    <div class="flex flex-wrap items-center gap-3">
      <For each={['ghost', 'outline', 'secondary'] as const}>
        {(variant) => (
          <CopyButton
            variant={variant}
            onClick={() => navigator.clipboard.writeText('Copied from Macro')}
            icon={<CopyIcon class="size-4" />}
          >
            Copy {variant}
          </CopyButton>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:sizes
function SizesDemo() {
  return (
    <div class="flex items-center gap-3">
      <For each={['sm', 'md', 'lg', 'icon-md'] as const}>
        {(size) => (
          <CopyButton
            aria-label="Copy example"
            tooltip="Copy example"
            size={size}
            variant="secondary"
            onClick={() => navigator.clipboard.writeText('Copied from Macro')}
            icon={<CopyIcon class="size-4" />}
          >
            {size !== 'icon-md' && 'Copy'}
          </CopyButton>
        )}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'CopyButton',
  category: 'Actions',
  description:
    'A normal Button with an explicit icon slot that blurs and fades to a green check after its onClick handler succeeds. Return the copy promise; return false or reject on failure. Feedback resets after the last successful copy; text-only buttons keep their content unchanged.',
  status: 'stable',
  exports: ['CopyButton'],
  import: "import { CopyButton } from '@ui';",
  demos: [
    {
      id: 'variants',
      title: 'Variants and success feedback',
      render: VariantsDemo,
    },
    { id: 'sizes', title: 'Copy feedback at each size', render: SizesDemo },
  ],
});
