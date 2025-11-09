import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { CircleSpinner } from './CircleSpinner';

const meta = {
  title: 'CircleSpinner',
  component: CircleSpinner,
  argTypes: {
    width: {
      control: { type: 'range', min: 12, max: 48, step: 4 },
    },
    height: {
      control: { type: 'range', min: 12, max: 48, step: 4 },
    },
  },
  parameters: {
    docs: {
      description: {
        component: 'A simple circular loading spinner.',
      },
    },
  },
} satisfies Meta<typeof CircleSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    width: 20,
    height: 20,
  },
};
