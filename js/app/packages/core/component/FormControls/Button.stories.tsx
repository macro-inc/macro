import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import {DeprecatedButton} from './DeprecatedButton';

const meta = {
  title: 'DeprecatedButton',
  component: DeprecatedButton,
} satisfies Meta<typeof DeprecatedButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <DeprecatedButton>Click me</DeprecatedButton>,
};