import { defineDoc } from '@app/features/ui-gallery/types';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import { For, Show } from 'solid-js';
import { Button, type ButtonVariant } from './Button';
import { ButtonGroup } from './ButtonGroup';

const VARIANTS: ButtonVariant[] = [
  'ghost',
  'outline',
  'accent',
  'success',
  'danger',
  'strong',
  'cta',
];

// #region demo:variants
function VariantsDemo() {
  return (
    <div class="flex w-full flex-col gap-3">
      <For each={VARIANTS}>
        {(variant) => (
          <div class="flex items-center gap-3">
            <span class="w-20 shrink-0 font-mono text-xs text-ink-subtle">
              {variant}
            </span>
            <Button variant={variant}>Button</Button>
            <Button variant={variant}>
              <PlusIcon />
              With icon
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:sizes
function SizesDemo() {
  return (
    <div class="flex flex-wrap items-end gap-3">
      <For each={['xs', 'sm', 'md', 'lg', 'xl'] as const}>
        {(size) => (
          <div class="flex flex-col items-start gap-1.5">
            <span class="font-mono text-xs text-ink-subtle">{size}</span>
            <Button variant="outline" size={size}>
              Button
            </Button>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:icon-only
function IconOnlyDemo() {
  return (
    <div class="flex flex-wrap items-end gap-3">
      <For each={['icon-xs', 'icon-sm', 'icon-md', 'icon-lg'] as const}>
        {(size) => (
          <div class="flex flex-col items-start gap-1.5">
            <span class="font-mono text-xs text-ink-subtle">{size}</span>
            <Button variant="outline" size={size} label="Add item">
              <PlusIcon />
            </Button>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:size-compositions
function SizeCompositionsDemo() {
  const sizes = [
    { size: 'xs', iconSize: 'icon-xs' },
    { size: 'sm', iconSize: 'icon-sm' },
    { size: 'md', iconSize: 'icon-md' },
    { size: 'lg', iconSize: 'icon-lg' },
    { size: 'xl', iconSize: undefined },
  ] as const;

  return (
    <div class="flex w-full flex-col gap-3">
      <For each={sizes}>
        {({ size, iconSize }) => (
          <div class="flex items-center gap-3">
            <span class="w-8 shrink-0 font-mono text-xs text-ink-subtle">
              {size}
            </span>
            <Button variant="outline" size={size} square label="Add item">
              <PlusIcon />
            </Button>
            <Button variant="outline" size={size}>
              Button
            </Button>
            <Button variant="outline" size={size}>
              <PlusIcon />
              With icon
            </Button>
            <Show when={iconSize}>
              {(resolvedIconSize) => (
                <Button
                  variant="outline"
                  size={resolvedIconSize()}
                  label={resolvedIconSize()}
                >
                  <PlusIcon />
                </Button>
              )}
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:group
function GroupDemo() {
  return (
    <div class="flex flex-col gap-4 items-center">
      <For each={['sm', 'md', 'lg'] as const}>
        {(size) => (
          <ButtonGroup variant="outline" size={size}>
            <Button>
              <TrashIcon />
              Delete
            </Button>
            <ButtonGroup.Divider />
            <Button>Duplicate</Button>
            <ButtonGroup.Divider />
            <Button>
              Next
              <ArrowRightIcon />
            </Button>
          </ButtonGroup>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:tooltip
function TooltipDemo() {
  return (
    <div class="flex flex-wrap items-center gap-3">
      <Button variant="outline" label="Create document" shortcut="⌘N">
        <PlusIcon />
      </Button>
      <Button variant="ghost" tooltip="Permanently deletes the selection">
        <TrashIcon />
        Delete
      </Button>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Button',
  category: 'Actions',
  description:
    'The standard way to trigger an action. Variant carries emphasis, size carries density, and both are shared with Badge so button-like elements line up.',
  status: 'stable',
  exports: ['Button', 'ButtonGroup'],
  import: "import { Button, ButtonGroup } from '@ui';",
  demos: [
    {
      id: 'variants',
      title: 'Variants',
      description:
        '`ghost` for low-emphasis actions in dense chrome, `outline` for standard actions, `accent` for the primary action in a group, `cta` for the single most important action on a screen. `danger` is reserved for destructive work.',
      render: VariantsDemo,
      fill: true,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      description:
        '`md` is the default. `sm` suits toolbars and inline chrome; `lg` and `xl` are for marketing and empty-state surfaces.',
      render: SizesDemo,
    },
    {
      id: 'icon-only',
      title: 'Icon-only',
      description:
        'Use an `icon-*` size for square buttons. `label` is required — it names the button for screen readers and becomes its tooltip.',
      render: IconOnlyDemo,
    },
    {
      id: 'size-compositions',
      title: 'Compositions by size',
      description:
        'Square regular-size, text-only, text-with-icon, and matching dedicated `icon-*` buttons shown together for direct comparison.',
      render: SizeCompositionsDemo,
      fill: true,
    },
    {
      id: 'group',
      title: 'Button group',
      description:
        '`ButtonGroup` joins related actions into a single segmented control. Add `ButtonGroup.Divider` between segments; the group owns the shared border and corner radius.',
      render: GroupDemo,
    },
    {
      id: 'tooltip',
      title: 'Tooltips and shortcuts',
      description:
        '`label` doubles as the tooltip; `tooltip` overrides it when the accessible name and the hint should differ. `hotkey` renders a registered shortcut, `shortcut` a raw string.',
      render: TooltipDemo,
    },
  ],
});
