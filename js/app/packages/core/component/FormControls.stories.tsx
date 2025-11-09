import { createSignal } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { Button } from './FormControls/Button';
import { SegmentedControl } from './FormControls/SegmentControls';
import { ToggleButton } from './FormControls/ToggleButton';
import { ToggleSwitch } from './FormControls/ToggleSwitch';

const meta = {
  title: 'FormControls',
  parameters: {
    docs: {
      description: {
        component:
          'A collection of reusable form control components including buttons, toggles, switches, and segmented controls.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ButtonDefault: Story = {
  name: 'Button - Default',
  render: () => (
    <Button size="Base" theme="primary">
      Button
    </Button>
  ),
};

export const ButtonVariations: Story = {
  name: 'Button - Variations',
  render: () => (
    <div class="space-y-4">
      <div class="space-x-2">
        <Button size="Base" theme="primary">
          Primary
        </Button>
        <Button size="Base" theme="secondary">
          Secondary
        </Button>
      </div>
      <div class="space-x-2">
        <Button size="SM" theme="primary">
          Small Primary
        </Button>
        <Button size="SM" theme="secondary">
          Small Secondary
        </Button>
      </div>
      <div class="space-x-2">
        <Button size="Base" theme="primary" disabled>
          Disabled Primary
        </Button>
        <Button size="Base" theme="secondary" disabled>
          Disabled Secondary
        </Button>
      </div>
      <div class="space-x-2">
        <Button size="Base" theme="primary" hotkeyShortcut="⌘+S">
          With Shortcut
        </Button>
      </div>
    </div>
  ),
};

export const ToggleButtonDefault: Story = {
  name: 'ToggleButton - Default',
  render: () => (
    <ToggleButton size="Base" pressed={false} animateFlickerOnDeactivate={true}>
      Select Me
    </ToggleButton>
  ),
};

export const ToggleButtonVariations: Story = {
  name: 'ToggleButton - Variations',
  render: () => {
    const [pressed1, setPressed1] = createSignal(false);
    const [pressed2, setPressed2] = createSignal(true);

    return (
      <div class="space-y-4">
        <div class="space-x-2">
          <ToggleButton
            size="Base"
            pressed={pressed1()}
            onChange={setPressed1}
            animateFlickerOnDeactivate={true}
          >
            Toggle Base
          </ToggleButton>
          <ToggleButton
            size="SM"
            pressed={pressed2()}
            onChange={setPressed2}
            animateFlickerOnDeactivate={false}
          >
            Toggle Small
          </ToggleButton>
        </div>
        <div class="text-sm text-ink-muted">
          Base: {pressed1() ? 'ON' : 'OFF'}, Small: {pressed2() ? 'ON' : 'OFF'}
        </div>
      </div>
    );
  },
};

export const ToggleSwitchDefault: Story = {
  name: 'ToggleSwitch - Default',
  render: () => (
    <ToggleSwitch
      label="Enable Feature"
      checked={false}
      animateFlicker={true}
      onChange={(checked: boolean) => console.log('Switch changed:', checked)}
    />
  ),
};

export const ToggleSwitchVariations: Story = {
  name: 'ToggleSwitch - Variations',
  render: () => {
    const [enabled1, setEnabled1] = createSignal(false);
    const [enabled2, setEnabled2] = createSignal(true);
    const [enabled3, setEnabled3] = createSignal(false);

    return (
      <div class="space-y-4">
        <ToggleSwitch
          label="Interactive Switch"
          checked={enabled1()}
          onChange={(checked) => {
            setEnabled1(checked);
            console.log('Switch 1 toggled:', checked);
          }}
          animateFlicker={true}
          labelPlacement="left"
        />
        <ToggleSwitch
          label="Simple Toggle (right label)"
          checked={enabled2()}
          onChange={(checked) => {
            setEnabled2(checked);
            console.log('Switch 2 toggled:', checked);
          }}
          animateFlicker={false}
          animateFlickerOnDeactivate={false}
          labelPlacement="right"
        />
        <ToggleSwitch
          label="No Flicker"
          checked={enabled3()}
          onChange={(checked) => {
            setEnabled3(checked);
            console.log('Switch 3 toggled:', checked);
          }}
          animateFlicker={false}
          animateFlickerOnDeactivate={false}
        />
        <div class="text-sm text-ink-muted">
          States: {enabled1() ? 'ON' : 'OFF'} | {enabled2() ? 'ON' : 'OFF'} |{' '}
          {enabled3() ? 'ON' : 'OFF'}
        </div>
      </div>
    );
  },
};

export const SegmentedControlDefault: Story = {
  name: 'SegmentedControl - Default',
  render: () => (
    <SegmentedControl
      list={['Option 1', 'Option 2', 'Option 3']}
      label="Choose Option"
      labelPlacement="left"
      size="Base"
    />
  ),
};

export const SegmentedControlVariations: Story = {
  name: 'SegmentedControl - Variations',
  render: () => {
    const [value1, setValue1] = createSignal('Option 2');
    const [value2, setValue2] = createSignal('Small');

    return (
      <div class="space-y-6">
        <SegmentedControl
          list={['Option 1', 'Option 2', 'Option 3']}
          label="Choose Option"
          labelPlacement="left"
          size="Base"
          value={value1()}
          onChange={setValue1}
        />
        <SegmentedControl
          list={[
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
          ]}
          label="Size"
          labelPlacement="right"
          size="SM"
          value={value2()}
          onChange={setValue2}
        />
        <div class="text-sm text-ink-muted">
          Selected: {value1()} | Size: {value2()}
        </div>
      </div>
    );
  },
};

export const AllFormControls: Story = {
  name: 'All Form Controls',
  render: () => {
    const [buttonPressed, setButtonPressed] = createSignal(false);
    const [switchEnabled, setSwitchEnabled] = createSignal(true);
    const [segmentValue, setSegmentValue] = createSignal('Medium');

    return (
      <div class="space-y-6 p-4">
        <div class="space-y-2">
          <h3 class="text-sm font-semibold">Buttons</h3>
          <div class="space-x-2">
            <Button size="Base" theme="primary">
              Primary Action
            </Button>
            <Button size="Base" theme="secondary">
              Secondary
            </Button>
            <Button size="SM" theme="primary" hotkeyShortcut="⌘+Enter">
              Save
            </Button>
          </div>
        </div>

        <div class="space-y-2">
          <h3 class="text-sm font-semibold">Toggle Button</h3>
          <ToggleButton
            size="Base"
            pressed={buttonPressed()}
            onChange={setButtonPressed}
            animateFlickerOnDeactivate={true}
          >
            {buttonPressed() ? 'Selected' : 'Select'}
          </ToggleButton>
        </div>

        <div class="space-y-2">
          <h3 class="text-sm font-semibold">Toggle Switch</h3>
          <ToggleSwitch
            label="Enable notifications"
            checked={switchEnabled()}
            onChange={setSwitchEnabled}
            animateFlicker={true}
            labelPlacement="left"
          />
        </div>

        <div class="space-y-2">
          <h3 class="text-sm font-semibold">Segmented Control</h3>
          <SegmentedControl
            list={['Small', 'Medium', 'Large']}
            label="Size"
            labelPlacement="left"
            size="Base"
            value={segmentValue()}
            onChange={setSegmentValue}
          />
        </div>

        <div class="p-3 bg-panel rounded text-sm">
          <div class="font-semibold mb-1">Current State:</div>
          <div>Toggle: {buttonPressed() ? 'Pressed' : 'Not Pressed'}</div>
          <div>Switch: {switchEnabled() ? 'Enabled' : 'Disabled'}</div>
          <div>Segment: {segmentValue()}</div>
        </div>
      </div>
    );
  },
};
