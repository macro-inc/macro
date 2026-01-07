import {
  BrightJoins,
  BrightJoinsProgressMeter,
} from '@ui/components/BrightJoins';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';

type DotsArray = [boolean, boolean, boolean, boolean];

interface StoryArgs {
  dots: string[];
  class?: string;
  progress?: number;
  progressMeterClass?: string;
}

function dotsToBooleanArray(dots?: string[]): DotsArray {
  if (!dots) return [false, false, false, false];
  return [
    dots.includes('TL'),
    dots.includes('TR'),
    dots.includes('BR'),
    dots.includes('BL'),
  ];
}

const meta: Meta<StoryArgs> = {
  component: BrightJoins as unknown as Meta<StoryArgs>['component'],
  argTypes: {
    dots: {
      control: { type: 'check' },
      options: ['TL', 'TR', 'BR', 'BL'],
      description: 'Which corner dots to show',
    },
  },
  args: {
    dots: ['TL', 'TR', 'BR', 'BL'],
  },
  render: (_, context) => {
    const dots = () => dotsToBooleanArray(context.args.dots);
    return (
      <div class="relative border border-edge-muted p-8 w-80 h-32">
        <BrightJoins dots={dots()} class={context.args.class} />
      </div>
    );
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const WithProgress: Story = {
  args: {
    dots: ['TR', 'TL', 'BR', 'BL'],
    progress: 50,
    progressMeterClass: '',
  },
  argTypes: {
    progress: {
      control: { type: 'range', min: 0, max: 100, step: 1 },
    },
    progressMeterClass: {
      control: { type: 'text' },
    },
  },
  render: (_, context) => {
    const dots = () => dotsToBooleanArray(context.args.dots);
    return (
      <div class="relative border border-edge-muted p-8 w-80 h-32">
        <BrightJoins dots={dots()} class={context.args.class} />
        <BrightJoinsProgressMeter
          progress={context.args.progress ?? 0}
          class={context.args.progressMeterClass}
        />
      </div>
    );
  },
};

export const OnlyOneCorner: Story = {
  args: {
    dots: ['TL'],
  },
};
