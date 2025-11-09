import { createSignal } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import {
  type FilteredTailwindColors,
  TailwindColorPicker,
} from './TailwindColorPicker';
import { TextButton } from './TextButton';

const meta = {
  title: 'TailwindColorPicker',
  component: TailwindColorPicker,
  parameters: {
    docs: {
      description: {
        component: 'A color picker menu using Tailwind color palette.',
      },
    },
  },
} satisfies Meta<typeof TailwindColorPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [show, setShow] = createSignal(false);
    const [selectedColor, setSelectedColor] =
      createSignal<FilteredTailwindColors>('blue');

    return (
      <div>
        <TextButton
          text={`Selected: ${selectedColor()}`}
          theme="base"
          onClick={() => setShow(!show())}
        />
        {show() && (
          <TailwindColorPicker
            show={() => show()}
            setShow={setShow}
            onColorSelect={(color) => {
              setSelectedColor(color);
              console.log('Color selected:', color);
            }}
          />
        )}
      </div>
    );
  },
};
