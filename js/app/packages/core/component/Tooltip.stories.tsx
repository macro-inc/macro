import IconGear from '@macro-icons/macro-gear.svg';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { DeprecatedIconButton } from './DeprecatedIconButton';
import { DeprecatedTextButton } from './DeprecatedTextButton';
import { LabelAndHotKey, Tooltip } from './Tooltip';

const meta = {
  title: 'Tooltip',
  component: Tooltip,
  argTypes: {
    placement: {
      control: { type: 'select' },
      options: [
        'top',
        'bottom',
        'left',
        'right',
        'top-start',
        'top-end',
        'bottom-start',
        'bottom-end',
      ],
    },
    delayOverride: {
      control: { type: 'range', min: 0, max: 1000, step: 50 },
    },
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    tooltip: <div class="text-xs">This is a simple tooltip</div>,
    children: <DeprecatedTextButton text="Hover me" theme="base" />,
  },
};

export const WithHotkey: Story = {
  args: {
    tooltip: <LabelAndHotKey label="Open Settings" shortcut="⌘," />,
    children: <DeprecatedIconButton icon={IconGear} theme="base" />,
  },
};

export const ComplexContent: Story = {
  args: {
    tooltip: (
      <div class="text-xs max-w-48">
        <div class="font-semibold mb-1">Complex Tooltip</div>
        <LabelAndHotKey label="Execute" shortcut="⌘⇧E" />
      </div>
    ),
    placement: 'top',
    children: <DeprecatedTextButton text="Complex tooltip" theme="accent" />,
  },
};
