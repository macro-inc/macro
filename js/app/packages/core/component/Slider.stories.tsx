import { createSignal } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { DebugSlider } from './Slider';

const meta = {
  title: 'Slider',
  component: DebugSlider,
  argTypes: {
    value: {
      control: { type: 'number' },
    },
    min: {
      control: { type: 'number' },
    },
    max: {
      control: { type: 'number' },
    },
    step: {
      control: { type: 'number', min: 0.01, max: 10, step: 0.01 },
    },
    decimals: {
      control: { type: 'number', min: 0, max: 5, step: 1 },
    },
    label: {
      control: { type: 'text' },
    },
  },
} satisfies Meta<typeof DebugSlider>;

export default meta;
type Story = StoryObj<typeof meta>;

const SliderWithState = (props: Parameters<typeof DebugSlider>[0]) => {
  const [value, setValue] = createSignal(props.value || 50);

  return (
    <div class="p-4">
      <DebugSlider
        {...props}
        value={value()}
        onChange={(newValue) => {
          setValue(newValue);
          console.log('Slider value changed to:', newValue);
        }}
      />
      <div class="mt-2 text-sm text-ink-muted">Current value: {value()}</div>
    </div>
  );
};

export const Default: Story = {
  render: () => (
    <SliderWithState
      label="Volume"
      value={50}
      min={0}
      max={100}
      step={1}
      onChange={() => {}}
    />
  ),
};

export const FloatingPoint: Story = {
  render: () => (
    <SliderWithState
      label="Scale Factor"
      value={1.5}
      min={0.1}
      max={3.0}
      step={0.1}
      decimals={1}
      onChange={() => {}}
    />
  ),
};

export const WithNegatives: Story = {
  render: () => (
    <SliderWithState
      label="Temperature (°C)"
      value={22}
      min={-10}
      max={40}
      step={1}
      decimals={0}
      onChange={() => {}}
    />
  ),
};
