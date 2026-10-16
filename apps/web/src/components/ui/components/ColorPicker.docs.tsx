import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { ColorPicker } from './ColorPicker';

// #region demo:basic
function BasicDemo() {
  const [value, setValue] = createSignal('#528bff');
  return (
    <ColorPicker.Root value={value()} onChange={setValue} class="w-56">
      <ColorPicker.Field />
      <ColorPicker.HueTrack />
      <ColorPicker.AlphaTrack />
      <div class="flex items-center gap-2">
        <ColorPicker.Preview />
        <ColorPicker.Input />
      </div>
    </ColorPicker.Root>
  );
}
// #endregion

// #region demo:disabled
function DisabledDemo() {
  return (
    <ColorPicker.Root defaultValue="#528bff80" disabled class="w-56">
      <ColorPicker.Field />
      <ColorPicker.HueTrack />
      <ColorPicker.AlphaTrack />
      <ColorPicker.Input />
    </ColorPicker.Root>
  );
}
// #endregion

export default defineDoc({
  name: 'ColorPicker',
  category: 'Inputs',
  description:
    'A compound RGB/hex picker with a saturation and brightness field, hue and opacity tracks, and hex input. Uses plain HSV math and Kobalte sliders.',
  status: 'stable',
  exports: ['ColorPicker'],
  import: "import { ColorPicker } from '@ui';",
  propTypes: ['ColorPickerRootProps'],
  demos: [
    {
      id: 'basic',
      title: 'Controlled picker',
      render: BasicDemo,
      description:
        'Compose the slots you need inside Root. `onChange` previews a hex color; `onChangeEnd` marks the end of a gesture. Input accepts short or long hex with optional alpha and commits on Enter or blur. Tab between saturation, brightness, hue, opacity, and text; arrows adjust channels and Shift makes larger steps. Unsupported values display black without changing the host value. Resolve CSS variables in the host before passing them to the picker.',
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: DisabledDemo,
      description:
        '`disabled` locks every slot. `readOnly` keeps text and field values available for inspection while preventing changes.',
    },
  ],
});
