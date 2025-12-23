import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { GlitchText } from './GlitchText';

const meta = {
  title: 'GlitchText',
  component: GlitchText,
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
    class: {
      control: 'text',
      description: 'CSS class name',
    },
  },
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
    class: 'font-mono',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Basic transform animation using default settings. Shows the component transitioning from source text to target text with default glitch characters, then stopping.',
      },
    },
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
  parameters: {
    docs: {
      description: {
        story:
          'Binary-themed decode animation using only "0" and "1" characters. Perfect for cyberpunk or tech-themed interfaces. Uses `to` only for a pure decode effect.',
      },
    },
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
  parameters: {
    docs: {
      description: {
        story:
          'Block character animation creating a distinctive chunky glitch effect. Uses Unicode block characters for a retro terminal aesthetic with continuous looping.',
      },
    },
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
  parameters: {
    docs: {
      description: {
        story:
          'Block character animation creating a distinctive chunky glitch effect. Uses Unicode block characters for a retro terminal aesthetic with continuous looping.',
      },
    },
  },
};
