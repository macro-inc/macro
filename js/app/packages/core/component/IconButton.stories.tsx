import IconGear from '@macro-icons/macro-gear.svg';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { IconButton } from './IconButton';

const meta = {
  title: 'IconButton',
  component: IconButton,
  argTypes: {
    theme: {
      control: { type: 'select' },
      options: [
        'base',
        'accent',
        'accentOpaque',
        'contrast',
        'clear',
        'selected',
        'green',
        'disabled',
        'red',
        'muted',
        'extraMuted',
        'accentFill',
        'current',
        'reverse',
      ],
    },
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'base', 'lg'],
    },
    disabled: {
      control: { type: 'boolean' },
    },
    showChevron: {
      control: { type: 'boolean' },
    },
    border: {
      control: { type: 'boolean' },
    },
    showShortcut: {
      control: { type: 'boolean' },
    },
    iconSize: {
      control: { type: 'range', min: 12, max: 32, step: 2 },
    },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    icon: IconGear,
    theme: 'base',
    size: 'base',
    disabled: false,
    showChevron: false,
    border: true,
    tooltip: { label: 'Settings', shortcut: '⌘,' },
  },
};
