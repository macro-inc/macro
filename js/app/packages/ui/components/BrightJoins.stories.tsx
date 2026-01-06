import {
  BrightJoins,
  BrightJoinsProgressMeter,
} from '@ui/components/BrightJoins';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';

const meta = {
  component: BrightJoins,
  argTypes: {
    dots: {
      control: { type: 'object' },
      defaultValue: [true, true, true, true],
      description: 'Array of booleans representing the corners of the joins',
    },
  },
  render: (args) => (
    <div class="relative border border-edge-muted p-8 w-80 h-32">
      <BrightJoins {...args} />
    </div>
  ),
} satisfies Meta<typeof BrightJoins>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    dots: [true, true, true, true],
  },
};

export const WithProgress: Story = {
  args: {
    dots: [true, true, true, true],
    progress: 50,
  },
  argTypes: {
    progress: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
    },
    progressMeterClass: {
      control: { type: 'text' },
      defaultValue: undefined,
    },
  },
  render: (args: Story['args']) => (
    <div class="relative border border-edge-muted p-8 w-80 h-32">
      <BrightJoins {...args} />
      <BrightJoinsProgressMeter
        progress={args.progress!}
        class={args.progressMeterClass}
      />
    </div>
  ),
};
export const OnlyOneCorner: Story = {
  args: {
    dots: [true, false, false, false],
  },
};
