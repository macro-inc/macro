import { Select } from '@ui/components/Select';
import { createMemo } from 'solid-js';

/** Compact app-native choice control for view configuration. */
export function ViewSelect(props: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
}) {
  const options = createMemo(() => props.options);
  return (
    <Select<{ value: string; label: string }>
      options={options()}
      optionValue="value"
      optionTextValue="label"
      value={options().find((option) => option.value === props.value)}
      onChange={(option) => {
        if (option && option.value !== props.value)
          props.onChange(option.value);
      }}
      placeholder={props.placeholder ?? 'Choose…'}
      disabled={props.disabled}
      class={props.class ?? 'min-w-0 flex-1'}
    >
      <Select.Trigger
        aria-label={props.label}
        class="h-8 rounded-md border border-edge-muted bg-input px-2 text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
      >
        <Select.Value<{ value: string; label: string }>>
          {(state) => state.selectedOption().label}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content portalScope="local" class="max-h-64 min-w-36 max-w-72">
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
