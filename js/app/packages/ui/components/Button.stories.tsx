import { Button } from '@ui/components/Button';
import type { PlayContext } from '@ui/types/storybook';
import { expect, fn } from 'storybook/test';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';

const meta = {
  component: Button,
  argTypes: {
    variant: {
      control: { type: 'radio' },
      options: {
        // @ts-ignore
        None: undefined,
        Primary: 'primary',
        Secondary: 'secondary',
        Tertiary: 'tertiary',
        Destructive: 'destructive',
      },
      defaultValue: undefined,
      description:
        'Variants provide shortcuts to common stylings, ommision is equivalent to "tertiary"',
    },
    children: {
      control: { type: 'text' },
      defaultValue: 'Click Here',
      description:
        'Anything can go inside buttons, eg icons, hotkey hints, etc.',
    },
    tooltip: {
      control: { type: 'text' },
      defaultValue: 'Tooltip',
      description:
        'Tooltips are so common, we made a slot. This supports any JSX, such as `<LabelAndHotkey />`',
    },
    showChevron: {
      control: { type: 'boolean' },
      defaultValue: false,
    },
    disabled: {
      control: { type: 'boolean' },
      defaultValue: false,
      description: 'Button supports anything a regular HTML button tag would.',
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
    try {
      await userEvent.click(button);
    } catch {}
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
