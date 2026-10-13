import { cn } from '@ui';
import { Show } from 'solid-js';
import { SettingsSelect } from '../../settings/components/settings-select';
import { SettingsRow } from '../../settings/primitives';

export type SelectRowOption = { id: string; name: string };

/**
 * A setting chosen from a dropdown. A disabled row stays visible but dimmed,
 * shows a not-allowed cursor, and says why it cannot be changed.
 */
export function SelectRow(props: {
  label: string;
  /** Names the dropdown for assistive tech; defaults to `label`. */
  controlLabel?: string;
  description: string;
  options: SelectRowOption[];
  value: string;
  disabled: boolean;
  /** Shown beneath the description while the row is disabled. */
  disabledReason?: string;
  /** Shown beneath the description whatever the row's state. */
  note?: string;
  onChange: (id: string) => void;
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
          <Show when={props.note}>
            {(note) => <span class="block">{note()}</span>}
          </Show>
        </>
      }
      class={cn(props.disabled && 'cursor-not-allowed opacity-60')}
    >
      <SettingsSelect
        label={props.controlLabel ?? props.label}
        options={props.options}
        value={props.value}
        disabled={props.disabled}
        onChange={(id) => {
          if (id !== props.value) props.onChange(id);
        }}
        class="w-48 shrink-0"
      />
    </SettingsRow>
  );
}
