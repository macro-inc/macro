import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { UserIcon } from './UserIcon';

const meta = {
  title: 'UserIcon',
  component: UserIcon,
  argTypes: {
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md', 'lg', 'xl', 'fill'],
    },
    isDeleted: {
      control: { type: 'boolean' },
    },
    suppressClick: {
      control: { type: 'boolean' },
    },
  },
} satisfies Meta<typeof UserIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    id: 'user-123',
    size: 'md',
    isDeleted: false,
    suppressClick: true,
  },
};
