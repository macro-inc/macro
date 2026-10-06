/** Compact, keyboard-accessible choices shared by the inspector's fields. */
import { Select } from '@kobalte/core/select';
import CaretDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';

type Option<T extends string> = { value: T; label: string; disabled?: boolean };

export function InspectorSelect<T extends string>(props: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  testId?: string;
  disabled?: boolean;
  class?: string;
}) {
  return (
    <Select<Option<T>>
      class={props.class ?? 'min-w-0 flex-1'}
      options={[...props.options]}
      optionValue={(option) => `value:${option.value}`}
      optionTextValue="label"
      optionDisabled="disabled"
      value={props.options.find((option) => option.value === props.value)}
      onChange={(option) => {
        if (option && option.value !== props.value)
          props.onChange(option.value);
      }}
      disabled={props.disabled}
      disallowEmptySelection
      placement="bottom-start"
      gutter={4}
      itemComponent={(item) => (
        <Select.Item
          item={item.item}
          class="relative flex h-6 items-center gap-2 rounded px-2 text-ink outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-contrast"
        >
          <span class="flex size-3 items-center justify-center">
            <Select.ItemIndicator>
              <Check class="size-3" />
            </Select.ItemIndicator>
          </span>
          <Select.ItemLabel>{item.item.rawValue.label}</Select.ItemLabel>
        </Select.Item>
      )}
    >
      <Select.Trigger
        onKeyDown={(event) => event.stopPropagation()}
        aria-label={props.label}
        data-testid={props.testId}
        title={
          props.options.find((option) => option.value === props.value)?.label
        }
        class="disabled:opacity-50 flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded-md bg-inset px-2 text-left text-ink outline-none hover:shadow-[inset_0_0_0_1px_var(--color-edge)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      >
        <Select.Value<Option<T>> class="truncate">
          {(state) => state.selectedOption().label}
        </Select.Value>
        <Select.Icon>
          <CaretDown class="size-3 shrink-0" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          class="fig-editor-theme z-modal min-w-32 max-w-72 rounded-xl border border-edge-muted bg-menu p-1.5 text-xs text-ink shadow-xl outline-none"
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
        >
          <Select.Listbox class="max-h-72 overflow-y-auto outline-none" />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}
