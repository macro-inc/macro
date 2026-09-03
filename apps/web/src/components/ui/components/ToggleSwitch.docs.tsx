import { defineDoc } from '@app/features/ui-gallery/types';
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
            <ToggleSwitch size={size} defaultChecked />
          </div>
        )}
      </For>
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
            <ToggleSwitch size="md" defaultChecked={row.on} />
          </div>
        )}
      </For>
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
        '`sm` is the default toolbar size; `md` is for settings rows; `xs` is for dense inline chrome.',
      render: SizesDemo,
    },
    {
      id: 'settings-row',
      title: 'Settings row',
      description:
        'The standard settings pattern: label and description on the left, switch on the right.',
      render: SettingsRowDemo,
    },
  ],
  props: [
    {
      name: 'checked',
      type: 'boolean',
      description: 'Controlled state. Pair with `onChange`.',
    },
    {
      name: 'defaultChecked',
      type: 'boolean',
      default: 'false',
      description: 'Initial state when uncontrolled.',
    },
    {
      name: 'onChange',
      type: '(checked: boolean) => void',
      description: 'Fires on user interaction.',
    },
    {
      name: 'size',
      type: "'xs' | 'sm' | 'md'",
      default: "'sm'",
      description: 'Control dimensions.',
    },
    {
      name: 'label',
      type: 'JSX.Element',
      description: 'Rendered beside the control and wired up as its label.',
    },
    {
      name: 'labelClass',
      type: 'string',
      description: 'Classes for the label element.',
    },
    {
      name: 'disabled',
      type: 'boolean',
      default: 'false',
      description: 'Blocks interaction.',
    },
  ],
  guidelines: {
    do: [
      'Use a switch only when the change takes effect immediately.',
      'Label the setting in its on-state ("Read receipts", not "Disable read receipts").',
      'Use `size="md"` in settings and `size="sm"` in toolbars.',
    ],
    dont: [
      'Do not put a switch in a form that has a Save button — use a Checkbox.',
      'Do not pair a switch with an on/off text label; the control already says it.',
    ],
  },
});
