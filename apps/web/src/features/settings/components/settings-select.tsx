import { Select } from '@ui';

type SettingsOption = { id: string; name: string };

/** A settings field using the app's accessible, styled select menu. */
export function SettingsSelect(props: {
  label: string;
  options: SettingsOption[];
  value?: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  class?: string;
}) {
  return (
    <Select<SettingsOption>
      class={props.class ?? 'min-w-0 w-full'}
      options={props.options}
      optionValue="id"
      optionTextValue="name"
      value={props.options.find((option) => option.id === props.value) ?? null}
      onChange={(option) => option && props.onChange(option.id)}
      disabled={props.disabled}
      placeholder={props.placeholder}
      disallowEmptySelection
    >
      <Select.Trigger aria-label={props.label} class="settings-input w-full">
        <Select.Value<SettingsOption>>
          {(state) => state.selectedOption().name}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content class="max-w-[calc(100vw-1rem)]" portalScope="local">
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}
