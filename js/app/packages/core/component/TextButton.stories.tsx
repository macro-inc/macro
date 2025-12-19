import IconGear from '@macro-icons/macro-gear.svg';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { DeprecatedTextButton } from './DeprecatedTextButton';

const meta = {
  title: 'TextButton',
  component: DeprecatedTextButton,
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
    disabled: {
      control: { type: 'boolean' },
    },
    showChevron: {
      control: { type: 'boolean' },
    },
    outline: {
      control: { type: 'boolean' },
    },
    hideShortcut: {
      control: { type: 'boolean' },
    },
    noGap: {
      control: { type: 'boolean' },
    },
  },
} satisfies Meta<typeof DeprecatedTextButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    text: 'Click me',
    theme: 'base',
    disabled: false,
    showChevron: false,
    icon: IconGear,
  },
};
