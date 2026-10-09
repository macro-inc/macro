import { Select } from '@ui/components/Select';
import { createMemo } from 'solid-js';

type ViewSelectOption<Value extends string> = { value: Value; label: string };

/** Compact app-native choice control for view configuration. */
export function ViewSelect<Value extends string>(props: {
  label: string;
  value: Value | undefined;
  options: ViewSelectOption<Value>[];
  onChange: (value: Value) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
}) {
  const options = createMemo(() => props.options);
  return (
    <Select<ViewSelectOption<Value>>
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
      itemComponent={(item) => (
        <Select.Item item={item.item}>
          <Select.ItemLabel>{item.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator />
        </Select.Item>
      )}
    >
      <Select.Trigger
        aria-label={props.label}
        class="h-8 rounded-md border border-edge-muted bg-input px-2 text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
      >
        <Select.Value<ViewSelectOption<Value>>>
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
