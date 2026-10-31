import { cn, Select } from '@ui';
import { inputClasses } from '@ui/components/Input';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

/** A labeled single-choice field on the shared Select. */
export function OptionSelect<T extends string>(props: {
  label: string;
  value: T | undefined;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Labels are personal data (contacts, inboxes): keep them out of session replay. */
  personal?: boolean;
  class?: string;
  onChange: (value: T) => void;
}) {
  return (
    <Select<SelectOption<T>>
      options={props.options}
      value={
        props.options.find((option) => option.value === props.value) ?? null
      }
      optionValue="value"
      optionTextValue="label"
      optionDisabled="disabled"
      placeholder={props.placeholder}
      disabled={props.disabled}
      onChange={(option) => option && props.onChange(option.value)}
      itemComponent={(item) => (
        <Select.Item item={item.item}>
          <Select.ItemLabel>{item.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator />
        </Select.Item>
      )}
    >
      <Select.Trigger
        aria-label={props.label}
        class={inputClasses({
          size: props.size ?? 'md',
          class: cn(
            'justify-between gap-2',
            props.personal && 'ph-no-capture',
            props.class
          ),
        })}
      >
        <Select.Value<SelectOption<T>> class="truncate">
          {(state) => state.selectedOption().label}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content class={props.personal ? 'ph-no-capture' : undefined}>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
