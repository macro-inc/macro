import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { EntityIcon } from './EntityIcon';

const meta = {
  title: 'EntityIcon',
  component: EntityIcon,
  argTypes: {
    targetType: {
      control: { type: 'select' },
      options: [
        'canvas',
        'html',
        'channel',
        'md',
        'pdf',
        'writer',
        'chat',
        'code',
        'image',
        'video',
        'color',
        'email',
        'user',
        'project',
        'default',
      ],
    },
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md', 'lg'],
    },
    theme: {
      control: { type: 'radio' },
      options: [undefined, 'monochrome'],
    },
    shared: {
      control: { type: 'boolean' },
    },
    useBackground: {
      control: { type: 'boolean' },
    },
  },
} satisfies Meta<typeof EntityIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    targetType: 'md',
    size: 'lg',
    shared: false,
    useBackground: false,
  },
};
