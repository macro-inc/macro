import { Button } from "./Button";
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { Hotkey } from '../Hotkey';
import { EntityIcon } from '../EntityIcon';


const meta = {
  title: 'Buttons',
  argTypes: {
    disabled: {
      control: { type: 'boolean', defaultValue: false },
    },
    class: {
      control: { type: 'text', defaultValue: '' },
    },
  } 
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  name: 'Button Variations',
  render: () => (
    <div class="space-y-4">
      <div class="flex gap-4">
        <Button primary>
          Primary
        </Button>
        <Button secondary>
          Secondary / default
        </Button>
        <Button tertiary>
          Tertiary
        </Button>
        <Button destructive>
          Destructive
        </Button>
      </div>
      <div class="flex gap-4">
        <Button primary disabled>
          Disabled Primary
        </Button>
        <Button secondary disabled>
          Disabled Secondary
        </Button>
         <Button destructive disabled>
          Disabled Destructive
        </Button>
      </div>
      <div class="flex gap-4 text-xl items-center">
        <Button primary>
          With Shortcut <Hotkey shortcut='cmd+s' />
        </Button>

        <Button primary>
          <EntityIcon theme='monochrome' /> With Icon
        </Button>

        <Button class="aspect-square">
          <EntityIcon targetType="pdf" theme='monochrome' size="md" />
        </Button>
      </div>
    </div>
  ),
};