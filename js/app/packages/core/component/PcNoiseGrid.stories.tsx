import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { PcNoiseGrid } from './PcNoiseGrid';

const meta = {
  title: 'PcNoiseGrid',
  component: PcNoiseGrid,
  parameters: {
    docs: {
      description: {
        component: 'WebGL-powered animated noise grid background effect.',
      },
    },
  },
} satisfies Meta<typeof PcNoiseGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    return (
      <div class="relative w-full h-96 border border-edge rounded overflow-hidden">
        <PcNoiseGrid />
      </div>
    );
  },
};
