import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { TailSpinner } from './TailSpinner';

const meta = {
  title: 'TailSpinner',
  component: TailSpinner,
  argTypes: {
    width: {
      control: { type: 'range', min: 20, max: 80, step: 4 },
    },
    height: {
      control: { type: 'range', min: 20, max: 80, step: 4 },
    },
  },
  parameters: {
    docs: {
      description: {
        component: 'A tail-style loading spinner with gradient animation.',
      },
    },
  },
} satisfies Meta<typeof TailSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    width: 38,
    height: 38,
  },
};
