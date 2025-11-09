import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { BozzyBracket } from './BozzyBracket';

const meta = {
  title: 'BozzyBracket',
  component: BozzyBracket,
  argTypes: {
    active: {
      control: { type: 'boolean' },
    },
    hover: {
      control: { type: 'boolean' },
    },
    unfocusable: {
      control: { type: 'boolean' },
    },
  },
  parameters: {
    docs: {
      description: {
        component: 'Places a highlight and bracket around active items.',
      },
    },
  },
} satisfies Meta<typeof BozzyBracket>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    active: true,
    hover: false,
    unfocusable: false,
    children: (
      <div class="p-4 text-ink">
        <p>Hover or activate this content to see the Bozzy Bracket</p>
      </div>
    ),
  },
};
