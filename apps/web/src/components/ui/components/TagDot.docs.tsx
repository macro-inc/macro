import { defineDoc } from '@app/features/ui-gallery/types';
import { For } from 'solid-js';
import { TagDot } from './TagDot';

// #region demo:fills
function FillsDemo() {
  return (
    <div class="flex items-center gap-4">
      <TagDot fill="var(--color-blue)" />
      <TagDot fills={['var(--color-blue)', 'var(--color-yellow)']} />
      <TagDot
        fills={[
          'var(--color-blue)',
          'var(--color-yellow)',
          'var(--color-red)',
          'var(--color-green)',
        ]}
      />
    </div>
  );
}
// #endregion

// #region demo:sizes
function SizesDemo() {
  return (
    <div class="flex items-center gap-4">
      <For each={['sm', 'md', 'lg'] as const}>
        {(size) => <TagDot size={size} fill="var(--color-blue)" />}
      </For>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'TagDot',
  category: 'Data Display',
  status: 'stable',
  description:
    'A circular color marker. Supply one fill or a list for up to four pie slices. Repeated fills increase their share; distinct fills keep input order. Pair with a text label.',
  exports: ['TagDot'],
  import: "import { TagDot } from '@ui';",
  demos: [
    { id: 'fills', title: 'Single and multiple fills', render: FillsDemo },
    {
      id: 'sizes',
      title: 'Sizes',
      description: 'sm: 8px, md (default): 10px, lg: 12px.',
      render: SizesDemo,
    },
  ],
});
