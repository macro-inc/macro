import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { BrightJoins } from './BrightJoins';
import BrightJoinsProgressMeter from './BrightJoinsProgressMeter';

const meta = {
  title: 'Rebranded/BrightJoinsProgressMeter',
  component: BrightJoinsProgressMeter,
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#1a1a1a' },
      ],
    },
  },
  argTypes: {
    progress: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
      description: 'Progress percentage (0-100)',
    },
  },
} satisfies Meta<typeof BrightJoinsProgressMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    progress: 45,
  },
  render: (args) => (
    <div class="relative border border-edge p-8 w-80 h-32">
      <BrightJoins />
      <BrightJoinsProgressMeter progress={args.progress} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Progress meter designed to work with BrightJoins component. Shows a gradient progress bar positioned at the top of a container with corner dots.',
      },
    },
  },
};
