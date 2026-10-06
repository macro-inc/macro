import { Checkbox, cn } from '@ui';
import { Show } from 'solid-js';
import { SettingsRow } from '../../settings/primitives';

/**
 * One kind of call with its checkbox. A disabled row stays visible but dimmed,
 * shows a not-allowed cursor, and says why it cannot be changed.
 */
export function RecordingKindRow(props: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  /** Shown beneath the description while the row is disabled. */
  disabledReason?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <SettingsRow
      label={props.label}
      description={
        <>
          {props.description}
          <Show when={props.disabled && props.disabledReason}>
            {(reason) => <span class="block">{reason()}</span>}
          </Show>
        </>
      }
      class={cn(props.disabled && 'cursor-not-allowed opacity-60')}
    >
      <Checkbox
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
        class="data-disabled:cursor-not-allowed"
      >
        <Checkbox.Control class="data-checked:bg-ink data-checked:border-ink text-panel" />
        <Checkbox.Label class="sr-only">{props.label}</Checkbox.Label>
      </Checkbox>
    </SettingsRow>
  );
}
