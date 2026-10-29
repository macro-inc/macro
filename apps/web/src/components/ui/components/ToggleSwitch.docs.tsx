import { defineDoc } from '@app/features/ui-gallery/types';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import { createSignal, For } from 'solid-js';
import { ToggleSwitch } from './ToggleSwitch';

// #region demo:basic
function BasicDemo() {
  const [enabled, setEnabled] = createSignal(true);

  return (
    <div class="flex flex-col gap-3">
      <ToggleSwitch
        checked={enabled()}
        onChange={setEnabled}
        label="Desktop notifications"
        labelClass="text-sm text-ink"
      />
      <span class="text-xs text-ink-subtle">
        Currently {enabled() ? 'on' : 'off'}
      </span>
    </div>
  );
}
// #endregion

// #region demo:sizes
function SizesDemo() {
  return (
    <div class="flex flex-wrap items-center gap-6">
      <For each={['xs', 'sm', 'md'] as const}>
        {(size) => (
          <div class="flex flex-col items-start gap-1.5">
            <span class="font-mono text-xs text-ink-subtle">{size}</span>
            <ToggleSwitch
              size={size}
              defaultChecked
              label={`${size} switch`}
              labelClass="sr-only"
            />
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:track-icon
function TrackIconDemo() {
  const [unreadOnly, setUnreadOnly] = createSignal(false);

  return (
    <ToggleSwitch
      trackIcon={EyeSlashIcon}
      checked={unreadOnly()}
      onChange={setUnreadOnly}
      label="Unread only"
      labelClass="text-sm text-ink"
    />
  );
}
// #endregion

// #region demo:disabled
function DisabledDemo() {
  return (
    <div class="flex flex-wrap items-center gap-6">
      <ToggleSwitch disabled label="Off" labelClass="text-sm text-ink" />
      <ToggleSwitch
        disabled
        defaultChecked
        label="On"
        labelClass="text-sm text-ink"
      />
    </div>
  );
}
// #endregion

// #region demo:settings-row
function SettingsRowDemo() {
  const rows = [
    {
      label: 'Read receipts',
      description: 'Let others see when you read a message.',
      on: true,
    },
    {
      label: 'Typing indicators',
      description: 'Show when you are composing.',
      on: false,
    },
  ];

  return (
    <div class="flex w-full max-w-md flex-col divide-y divide-edge-muted">
      <For each={rows}>
        {(row) => (
          <div class="flex items-center justify-between gap-4 py-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm text-ink">{row.label}</span>
              <span class="text-xs text-ink-subtle">{row.description}</span>
            </div>
            <ToggleSwitch
              size="md"
              defaultChecked={row.on}
              label={row.label}
              labelClass="sr-only"
            />
          </div>
        )}
      </For>
    </div>
  );
}
// #endregion

// #region demo:form-state
function FormStateDemo() {
  return (
    <div class="flex flex-col gap-3">
      <ToggleSwitch
        name="readonly-setting"
        readOnly
        defaultChecked
        label="Read-only setting"
      />
      <ToggleSwitch validationState="invalid" label="Setting needs attention" />
      <span class="text-xs text-failure">
        This setting cannot be changed yet.
      </span>
    </div>
  );
}
// #endregion
export default defineDoc({
  name: 'Toggle Switch',
  category: 'Inputs',
  description:
    'An on/off switch for a setting that applies immediately. If the change needs a save step, use a Checkbox instead.',
  status: 'stable',
  exports: ['ToggleSwitch'],
  import: "import { ToggleSwitch } from '@ui';",
  demos: [
    {
      id: 'basic',
      title: 'Basic',
      description:
        'Controlled via `checked` and `onChange`, or uncontrolled via `defaultChecked`. The whole component — including the gap between control and label — is one hit target.',
      render: BasicDemo,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      description:
        '`sm` is the default toolbar size (32×16px); `md` is for settings rows (40×20px); `xs` is for dense inline chrome (28×14px).',
      render: SizesDemo,
    },
    {
      id: 'track-icon',
      title: 'Track icon',
      description:
        '`trackIcon` shows a glyph in the half of the track the thumb leaves free, so a compact switch says what it does even when its label is hidden.',
      render: TrackIconDemo,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      description:
        'A disabled switch dims, label included, and ignores clicks, like a disabled Checkbox.',
      render: DisabledDemo,
    },
    {
      id: 'form-state',
      title: 'Read-only and invalid',
      description:
        'Native form props and Kobalte state remain available. The thumb stays white across themes and states, and motion respects prefers-reduced-motion.',
      render: FormStateDemo,
    },
    {
      id: 'settings-row',
      title: 'Settings row',
      description:
        'The standard settings pattern: label and description on the left, switch on the right.',
      render: SettingsRowDemo,
    },
  ],
});
