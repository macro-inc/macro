import { Select } from '@ui';
import { inputClasses } from '@ui/components/Input';
import type { JSX } from 'solid-js';

export function InspectorSelect<T extends string>(props: {
  label: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  renderIcon?: (value: T) => JSX.Element;
}) {
  type Option = { value: T; label: string };
  const optionLabel = (option: Option) => (
    <span class="flex min-w-0 items-center gap-1.5" title={option.label}>
      {props.renderIcon?.(option.value)}
      <span class="truncate">{option.label}</span>
    </span>
  );
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
          <Select.ItemLabel>{optionLabel(item.item.rawValue)}</Select.ItemLabel>
          <Select.ItemIndicator class="text-ink-muted" />
        </Select.Item>
      )}
    >
      <Select.Trigger
        aria-label={props.label}
        class={inputClasses({
          size: 'sm',
          class:
            'border-transparent bg-hover/50 text-xs hover:border-edge-muted',
        })}
      >
        <Select.Value<Option>>
          {(state) => optionLabel(state.selectedOption())}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
