import IconFile from '@icon/regular/file.svg?component-solid';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import IconGear from '@macro-icons/macro-gear.svg';
import { createSignal } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { DropdownMenuContent, MenuItem, MenuSeparator } from './Menu';
import { TextButton } from './TextButton';

const meta = {
  title: 'Menu',
  parameters: {
    docs: {
      description: {
        component:
          'Menu items for context and dropdown menus. Supports regular, checkbox, and radio variants.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [checked1, setChecked1] = createSignal(true);
    const [checked2, setChecked2] = createSignal(false);
    const [radioValue, setRadioValue] = createSignal('option1');

    return (
      <DropdownMenu placement="bottom-start">
        <DropdownMenu.Trigger>
          <TextButton text="Open Menu" theme="base" />
        </DropdownMenu.Trigger>
        <DropdownMenuContent>
          <MenuItem
            text="Regular Item"
            icon={IconFile}
            onClick={() => console.log('Clicked')}
          />
          <MenuItem
            text="With Icon"
            icon={IconGear}
            onClick={() => console.log('Settings')}
          />
          <MenuItem text="Disabled Item" disabled={true} />
          <MenuSeparator />
          <MenuItem
            text="Checkbox Item 1"
            selectorType="checkbox"
            checked={checked1()}
            onChange={setChecked1}
          />
          <MenuItem
            text="Checkbox Item 2"
            selectorType="checkbox"
            checked={checked2()}
            onChange={setChecked2}
          />
          <MenuSeparator />
          <DropdownMenu.RadioGroup
            value={radioValue()}
            onChange={setRadioValue}
          >
            <MenuItem
              text="Radio Option 1"
              selectorType="radio"
              value="option1"
              groupValue={radioValue()}
            />
            <MenuItem
              text="Radio Option 2"
              selectorType="radio"
              value="option2"
              groupValue={radioValue()}
            />
            <MenuItem
              text="Radio Option 3"
              selectorType="radio"
              value="option3"
              groupValue={radioValue()}
            />
          </DropdownMenu.RadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
};
