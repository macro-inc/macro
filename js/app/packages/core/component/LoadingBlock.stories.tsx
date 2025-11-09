import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { LoadingBlock } from './LoadingBlock';

const meta = {
  title: 'LoadingBlock',
  component: LoadingBlock,
  parameters: {
    docs: {
      description: {
        component: 'A full-sized loading panel for block-level content.',
      },
    },
  },
} satisfies Meta<typeof LoadingBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    return (
      <div class="w-full h-64 border border-edge rounded">
        <LoadingBlock />
      </div>
    );
  },
};
