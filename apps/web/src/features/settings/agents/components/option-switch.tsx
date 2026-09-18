import { For } from 'solid-js';

/** Native radios retain keyboard navigation inside a compact segmented control. */
export function OptionSwitch<T extends string>(props: {
  label: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset class="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-ink/5 p-1">
      <legend class="sr-only">{props.label}</legend>
      <For each={props.options}>
        {(option) => (
          <label class="relative rounded-md px-3 py-1.5 text-xs text-ink-muted has-checked:bg-surface has-checked:text-ink has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-accent has-disabled:opacity-50">
            <input
              class="sr-only"
              type="radio"
              name={props.name}
              value={option.value}
              checked={props.value === option.value}
              disabled={option.disabled}
              onChange={() => props.onChange(option.value)}
            />
            {option.label}
          </label>
        )}
      </For>
    </fieldset>
  );
}
