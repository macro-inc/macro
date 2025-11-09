import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { BetaBadge } from './BetaBadge';

const meta = {
  title: 'BetaBadge',
  component: BetaBadge,
  parameters: {
    docs: {
      description: {
        component: 'A beta indicator badge with accent styling.',
      },
    },
  },
} satisfies Meta<typeof BetaBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
