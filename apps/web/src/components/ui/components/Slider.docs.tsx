import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { Slider } from './Slider';

// #region demo:single
function SingleDemo() {
  const [value, setValue] = createSignal([30]);
  return (
    <Slider
      value={value()}
      onChange={setValue}
      minValue={5}
      maxValue={120}
      step={5}
      class="max-w-sm"
    >
      <div class="flex justify-between text-sm">
        <Slider.Label>Duration</Slider.Label>
        <span>{value()[0]} min</span>
      </div>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb aria-valuetext={`${value()[0]} minutes`}>
          <Slider.Input />
        </Slider.Thumb>
      </Slider.Track>
    </Slider>
  );
}
// #endregion

// #region demo:range
function RangeDemo() {
  const [values, setValues] = createSignal([20, 80]);
  return (
    <Slider
      aria-label="Selected range"
      value={values()}
      onChange={setValues}
      class="max-w-sm"
    >
      <span class="text-sm">Selected range</span>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb aria-label="Range start">
          <Slider.Input />
        </Slider.Thumb>
        <Slider.Thumb aria-label="Range end">
          <Slider.Input />
        </Slider.Thumb>
      </Slider.Track>
      <Slider.ValueLabel class="text-xs text-ink-muted" />
    </Slider>
  );
}
// #endregion

export default defineDoc({
  name: 'Slider',
  category: 'Inputs',
  status: 'stable',
  description:
    'Keyboard and pointer range selection with one or multiple thumbs. Compose labels, inputs, and track segments as slots.',
  exports: ['Slider'],
  propTypes: [
    'SliderRootProps',
    'SliderTrackProps',
    'SliderFillProps',
    'SliderThumbProps',
  ],
  import: "import { Slider } from '@ui';",
  demos: [
    { id: 'single', title: 'Single value', render: SingleDemo },
    { id: 'range', title: 'Multiple thumbs', render: RangeDemo },
  ],
});
