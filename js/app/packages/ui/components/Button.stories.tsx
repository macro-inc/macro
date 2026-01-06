import type { PlayContext } from '@ui/types/storybook';
import { Button } from '@ui/components/Button';
import { expect, fn } from 'storybook/test';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';

const meta = {
  title: 'Buttons',
  component: Button,
  argTypes: {
    variant: {
      control: { type: 'radio' },
      options: {
        None: undefined,
        Primary: 'primary',
        Secondary: 'secondary',
        Tertiary: 'tertiary',
        Destructive: 'destructive',
      },
      defaultValue: 'tertiary',
      table: {
        type: { summary: 'primary | secondary | tertiary | destructive' },
        defaultValue: { summary: 'tertiary' },
      },
    },
    children: {
      control: { type: 'text' },
      defaultValue: 'Click Here',
    },
    tooltip: {
      control: { type: 'text' },
      defaultValue: 'Tooltip',
    },
    showChevron: {
      control: { type: 'boolean' },
      defaultValue: false,
    },
    class: {
      control: { type: 'text' },
      defaultValue: '',
    },
    disabled: {
      control: { type: 'boolean' },
      defaultValue: false,
    },
  },
  args: {
    onClick: fn(),
    children: 'Click Here',
  },
  render: (args) => <Button {...args}>{args.children}</Button>,
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    variant: undefined,
    disabled: false,
    class: undefined,
    showChevron: false,
    type: 'button',
    tooltip: 'Tooltip',
    children: 'Click Here',
  },
  play: async ({ canvas, userEvent, args }: PlayContext<Story>) => {
    const button = canvas.getByText('Click Here');
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalled();
  },
};

export const Primary: Story = {
  args: {
    variant: 'primary',
  },
};

export const PrimaryWithChevron: Story = {
  args: {
    variant: 'primary',
    showChevron: true,
  },
};

export const PrimaryDisabled: Story = {
  args: {
    variant: 'primary',
    disabled: true,
    children: 'I am Disabled',
  },
  play: async ({ canvas, userEvent, args }: PlayContext<Story>) => {
    const button = canvas.getByText('I am Disabled');
    await userEvent.click(button);
    await expect(button).toBeDisabled();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
  },
};

export const Tertiary: Story = {
  args: {
    variant: 'tertiary',
  },
};
