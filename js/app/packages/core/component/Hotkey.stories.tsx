import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { BasicHotkey } from './Hotkey';

const meta = {
  title: 'Hotkey',
  component: BasicHotkey,
  argTypes: {
    shortcut: {
      control: { type: 'text' },
    },
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
      ],
    },
  },
} satisfies Meta<typeof BasicHotkey>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    shortcut: 'cmd+s',
    theme: 'base',
  },
};

export const MultipleModifiers: Story = {
  args: {
    shortcut: 'cmd+shift+p',
    theme: 'accent',
  },
};

export const SingleKey: Story = {
  args: {
    shortcut: 'g',
    theme: 'muted',
  },
};
