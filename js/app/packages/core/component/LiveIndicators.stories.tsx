import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { LiveIndicators } from './LiveIndicators';

const meta = {
  title: 'LiveIndicators',
  component: LiveIndicators,
  parameters: {
    docs: {
      description: {
        component: 'Shows avatars of users currently viewing/editing content.',
      },
    },
  },
} satisfies Meta<typeof LiveIndicators>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    userIds: [
      'user1|user1@example.com',
      'user2|user2@example.com',
      'user3|user3@example.com',
    ],
    currentUserId: undefined,
  },
};

export const ManyUsers: Story = {
  args: {
    userIds: [
      'user1|alice@example.com',
      'user2|bob@example.com',
      'user3|charlie@example.com',
      'user4|diana@example.com',
      'user5|eve@example.com',
    ],
    currentUserId: undefined,
  },
};
