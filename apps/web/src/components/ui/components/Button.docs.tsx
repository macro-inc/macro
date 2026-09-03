import { defineDoc } from '@app/features/ui-gallery/types';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash.svg';
import { For } from 'solid-js';
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

// #region demo:group
function GroupDemo() {
  return (
    <ButtonGroup>
      <Button variant="outline">
        <TrashIcon />
        Delete
      </Button>
      <Button variant="outline">Duplicate</Button>
      <Button variant="outline">
        Next
        <ArrowRightIcon />
      </Button>
    </ButtonGroup>
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
      id: 'group',
      title: 'Button group',
      description:
        '`ButtonGroup` joins related actions into a single segmented control and squares off the interior corners.',
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
  props: [
    {
      name: 'variant',
      type: "'ghost' | 'outline' | 'accent' | 'success' | 'danger' | 'strong' | 'cta'",
      default: "'ghost'",
      description: 'Emphasis level.',
    },
    {
      name: 'size',
      type: "'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'icon-xs' | 'icon-sm' | 'icon-md' | 'icon-lg'",
      default: "'md'",
      description: 'Height, padding, and icon scale.',
    },
    {
      name: 'label',
      type: 'string',
      description:
        'Accessible name, and the tooltip unless `tooltip` overrides it. Required for icon-only buttons.',
    },
    {
      name: 'tooltip',
      type: 'string',
      description: 'Tooltip content when it should differ from `label`.',
    },
    {
      name: 'hotkey',
      type: 'HotkeyToken | HotkeyToken[]',
      description: 'Registered shortcut to display in the tooltip.',
    },
    {
      name: 'shortcut',
      type: 'string | string[]',
      description: 'Raw shortcut text, when no hotkey token exists.',
    },
    {
      name: 'depth',
      type: '0 | 1 | 2 | 3 | 4',
      description:
        'Overrides the inherited layer depth. Rarely needed — the surrounding Panel usually sets it.',
    },
    {
      name: 'square',
      type: 'boolean',
      default: 'false',
      description: 'Forces a 1:1 aspect ratio and drops horizontal padding.',
    },
    {
      name: 'fullWidth',
      type: 'boolean',
      default: 'false',
      description:
        'Stretches the button, and its tooltip wrapper, to the available width.',
    },
    {
      name: 'disabled',
      type: 'boolean',
      default: 'false',
      description: 'Blocks interaction and drops the button to 30% opacity.',
    },
  ],
  guidelines: {
    do: [
      'Give every screen at most one `cta` or `accent` button.',
      'Always set `label` on icon-only buttons.',
      'Use `danger` only for destructive actions, paired with a confirmation.',
    ],
    dont: [
      'Do not restyle a button with utility classes when a variant already covers it.',
      'Do not use a Button for navigation that should be a link.',
      'Do not put two `danger` buttons next to each other.',
    ],
  },
});
