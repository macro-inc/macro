import { defineDoc } from '@app/features/ui-gallery/types';
import CopyIcon from '@phosphor/copy.svg';
import { For } from 'solid-js';
import { CopyButton } from './CopyButton';

// #region demo:variants
function VariantsDemo() {
  return (
    <div class="flex flex-wrap items-center gap-3">
      <For each={['ghost', 'outline', 'strong'] as const}>
        {(variant) => (
          <CopyButton
            variant={variant}
            onClick={() => navigator.clipboard.writeText('Copied from Macro')}
          >
            <CopyIcon />
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
            size={size}
            variant="outline"
            label="Copy example"
            onClick={() => navigator.clipboard.writeText('Copied from Macro')}
          >
            <CopyIcon />
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
    'A normal Button that fades its first icon to a solid green check-circle after its onClick handler succeeds. Return the copy promise; return false or reject on failure. Text-only buttons keep their content unchanged.',
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
