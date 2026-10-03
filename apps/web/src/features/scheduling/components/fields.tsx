import { TimezoneSelect } from '@app/features/reminders/TimezoneSelect';
import { Checkbox, cn, Select } from '@ui';
import { type JSX, Show, splitProps } from 'solid-js';

export function Field(props: {
  label: string;
  hint?: string;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <label
      class={cn('flex min-w-0 flex-col gap-2 text-sm text-ink', props.class)}
    >
      <span class="font-medium">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="text-xs leading-relaxed text-ink-muted">{props.hint}</span>
      </Show>
    </label>
  );
}
export function TextInput(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <input
      {...rest}
      class={cn(
        'h-10 w-full min-w-0 rounded-lg border border-edge bg-surface-2 px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus-visible:ring-2 focus-visible:ring-ink/20 disabled:opacity-50',
        local.class
      )}
    />
  );
}
export function TextArea(
  props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <textarea
      {...rest}
      class={cn(
        'h-10 w-full min-w-0 rounded-lg border border-edge bg-surface-2 px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus-visible:ring-2 focus-visible:ring-ink/20 disabled:opacity-50',
        'h-auto min-h-24 resize-y py-3',
        local.class
      )}
    />
  );
}
export function SelectInput(props: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select<{ value: string; label: string }>
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={props.options.find((o) => o.value === props.value)}
      onChange={(option) => option && props.onChange(option.value)}
      disabled={props.disabled}
      modal={false}
    >
      <Select.Trigger
        aria-label={props.label}
        class={
          'h-10 w-full min-w-0 rounded-lg border border-edge bg-surface-2 px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus-visible:ring-2 focus-visible:ring-ink/20 disabled:opacity-50'
        }
      >
        <Select.Value<{ value: string; label: string }>>
          {(state) => state.selectedOption()?.label}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
export function TimeZoneInput(props: {
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={props.disabled} class="min-w-0">
      <TimezoneSelect
        value={props.value}
        onChange={props.onChange}
        options={Intl.supportedValuesOf('timeZone').map((value) => ({
          value,
          label: value.replaceAll('_', ' '),
        }))}
        class="h-10 w-full rounded-lg border-edge bg-surface-2 px-3"
      />
    </fieldset>
  );
}
export function CheckField(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <Checkbox
      checked={props.checked}
      onChange={props.onChange}
      class="gap-3 text-sm"
    >
      <Checkbox.Control class="data-checked:bg-ink data-checked:border-ink text-panel" />
      <Checkbox.Label>{props.label}</Checkbox.Label>
    </Checkbox>
  );
}
