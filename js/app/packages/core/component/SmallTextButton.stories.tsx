import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { SmallTextButton } from './SmallTextButton';

const meta = {
  title: 'SmallTextButton',
  component: SmallTextButton,
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
    showChevron: {
      control: { type: 'boolean' },
    },
    rotateChevron: {
      control: { type: 'boolean' },
    },
    border: {
      control: { type: 'boolean' },
    },
  },
} satisfies Meta<typeof SmallTextButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    text: 'Small Button',
    theme: 'base',
    showChevron: false,
    rotateChevron: false,
    border: true,
  },
};
