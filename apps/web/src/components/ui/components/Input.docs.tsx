import { defineDoc } from '@app/features/ui-gallery/types';
import { For } from 'solid-js';
import { Input, type InputSize } from './Input';

// #region demo:basic
function BasicDemo() {
  return (
    <Input
      class="max-w-sm"
      type="email"
      placeholder="name@example.com"
      aria-label="Email address"
    />
  );
}
// #endregion

// #region demo:sizes
function SizesDemo() {
  const sizes: InputSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

  return (
    <div class="flex w-full max-w-sm flex-col gap-3">
      <For each={sizes}>
        {(size) => (
          <div class="grid grid-cols-[2rem_1fr] items-center gap-3">
            <span class="font-mono text-xs text-ink-subtle">{size}</span>
            <Input size={size} placeholder={`${size} input`} />
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:variants
function VariantsDemo() {
  return (
    <div class="flex w-full max-w-sm flex-col gap-3 rounded-md bg-inset p-3">
      <Input variant="outline" placeholder="Outline" />
      <Input variant="bare" placeholder="Bare" />
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Input',
  category: 'Inputs',
  description:
    'A thin shadcn-style native input with semantic tokens and Button-compatible visual sizes. Compose icons and actions with InputGroup.',
  status: 'stable',
  exports: ['Input'],
  import: "import { Input } from '@ui';",
  demos: [
    {
      id: 'basic',
      title: 'Basic',
      description:
        'All normal native input props are forwarded. The default visual size is `md` and the default variant is `outline`.',
      render: BasicDemo,
    },
    {
      id: 'sizes',
      title: 'Button sizes',
      description:
        'String sizes share heights, padding, and typography with text Buttons. A numeric `size` remains the native HTML attribute.',
      render: SizesDemo,
    },
    {
      id: 'variants',
      title: 'Variants',
      description:
        '`bare` stays transparent without hover or focus chrome. It is intended for a composed parent such as InputGroup.',
      render: VariantsDemo,
    },
  ],
});
