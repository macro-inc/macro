import { GlitchText, type GlitchTextProps } from '@ui/components/GlitchText';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';

const meta = {
  component: GlitchText,
  argTypes: {
    from: {
      control: 'text',
      description: 'Starting text (corruption mode)',
    },
    to: {
      control: 'text',
      description: 'Target text (decode mode)',
    },
    continuous: {
      control: 'boolean',
      description: 'Loop animation continuously',
      defaultValue: true,
    },
    chars: {
      control: 'text',
      description: 'Character set for glitch effect (string of characters)',
    },
    cycles: {
      control: { type: 'range', min: 1, max: 5, step: 1 },
      description: 'Number of complete cycles per animation phase (default: 1)',
    },
    framerate: {
      control: { type: 'range', min: 1, max: 60, step: 1 },
      description: 'Frames per second for animation timing',
    },
    delay: {
      control: { type: 'range', min: 0, max: 1000, step: 50 },
      description: 'Delay for initial start and holding clear text (ms)',
    },
  },
  render: (args: GlitchTextProps) => <GlitchText {...args} />,
} satisfies Meta<typeof GlitchText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    from: 'Hello World',
    to: 'Nice to meet you',
    continuous: false,
    chars: '!@#$%^&*()_+-=[]{}|;\':",./<>?',
    cycles: 2,
    framerate: 12,
    delay: 1000,
    class: 'font-mono text-ink-extra-muted',
  },
};

export const Binary: Story = {
  args: {
    to: 'SYSTEM ONLINE',
    chars: '01',
    cycles: 5,
    framerate: 60,
    delay: 100,
    class: 'font-mono text-success',
  },
};

export const Blocks: Story = {
  args: {
    from: 'LOADING',
    to: 'COMPLETE',
    chars: '█▓▒░',
    continuous: false,
    cycles: 10,
    framerate: 60,
    delay: 800,
    class: 'font-mono text-accent text-4xl',
  },
};

export const Chess: Story = {
  args: {
    from: 'Checkmate.',
    chars: '♟♝♞♜♛♚',
    continuous: false,
    cycles: 1,
    framerate: 12,
    delay: 1000,
    class: 'font-serif text-failure text-4xl',
  },
};
