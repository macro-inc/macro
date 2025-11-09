import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ProfilePicture } from './ProfilePicture';

const meta = {
  title: 'ProfilePicture',
  component: ProfilePicture,
  parameters: {
    docs: {
      description: {
        component: 'Profile picture component with fallback to user initials.',
      },
    },
  },
} satisfies Meta<typeof ProfilePicture>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    id: 'user-123',
    sizeClass: {
      container: 'size-8',
      icon: 'w-4 h-4',
      text: 'text-lg leading-none',
    },
    email: 'user@example.com',
    fetchUrl: false,
  },
};
