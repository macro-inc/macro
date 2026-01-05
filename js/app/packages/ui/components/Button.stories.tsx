import { EntityIcon } from 'core/component/EntityIcon';
import { Hotkey } from 'core/component/Hotkey';
import { LabelAndHotKey } from 'core/component/Tooltip';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { Button } from './Button';

const meta = {
  title: 'Buttons',
  argTypes: {
    disabled: {
      control: { type: 'boolean', defaultValue: false },
    },
    class: {
      control: { type: 'text', defaultValue: '' },
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  name: 'Button Variations',
  render: () => (
    <div class="space-y-4">
      <div class="flex gap-4">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="tertiary">Tertiary / default</Button>
        <Button variant="destructive">Destructive</Button>
      </div>
      <div class="flex gap-4">
        <Button variant="primary" disabled>
          Disabled Primary
        </Button>
        <Button variant="secondary" disabled>
          Disabled Secondary
        </Button>
        <Button variant="destructive" disabled>
          Disabled Destructive
        </Button>
      </div>
      <div class="flex gap-4 text-xl items-center">
        <Button variant="primary">
          With shortcut <Hotkey shortcut="cmd+s" />
        </Button>

        <Button variant="primary">
          <EntityIcon theme="monochrome" /> With Icon
        </Button>

        <Button
          class="aspect-square"
          tooltip={
            <LabelAndHotKey label="With custom styling" shortcut="cmd+s" />
          }
        >
          <EntityIcon targetType="pdf" theme="monochrome" size="md" />
        </Button>
      </div>
    </div>
  ),
};
