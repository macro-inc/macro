import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { LoadingSpinner } from './LoadingSpinner';

const meta = {
  title: 'LoadingSpinner',
  component: LoadingSpinner,
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#1a1a1a' },
      ],
    },
  },
} satisfies Meta<typeof LoadingSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
