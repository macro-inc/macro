import { ToggleSwitch } from '@ui';

/**
 * The message/task mode switch shown in the input footer, next to the
 * format (`Aa`) button in message mode and next to the attach button in
 * task mode. Checked means the input is composing a task. Outlined as a
 * pill so the label and switch read as one control.
 */
export function TaskModeSwitch(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <ToggleSwitch
      checked={props.checked}
      onChange={props.onChange}
      label="Task"
      class="h-6 gap-1.5 rounded-full border border-edge-muted bg-surface px-2 hover:bg-hover"
      labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
    />
  );
}
