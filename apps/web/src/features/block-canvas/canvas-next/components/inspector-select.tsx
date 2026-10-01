import { Select } from '@ui';
import { inputClasses } from '@ui/components/Input';

export function InspectorSelect<T extends string>(props: {
  label: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  type Option = { value: T; label: string };
  return (
    <Select<Option>
      options={props.options}
      value={
        props.options.find((option) => option.value === props.value) ?? null
      }
      optionValue="value"
      optionTextValue="label"
      placeholder="Mixed"
      onChange={(option) => option && props.onChange(option.value)}
      itemComponent={(item) => (
        <Select.Item item={item.item} class="text-xs">
          <Select.ItemLabel>{item.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator class="text-ink-muted" />
        </Select.Item>
      )}
    >
      <Select.Trigger
        aria-label={props.label}
        class={inputClasses({ size: 'md', class: 'text-xs' })}
      >
        <Select.Value<Option>>
          {(state) => state.selectedOption().label}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
