import { For, type JSX } from 'solid-js';

export function FieldInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  list?: string;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <label class="flex min-w-0 flex-col gap-1 text-xs text-ink-muted">
      <span>{props.label}</span>
      {props.multiline ? (
        <textarea
          class="min-h-24 w-full resize-y rounded-md border border-edge-muted bg-input px-3 py-2 text-sm text-ink outline-none focus:border-edge"
          value={props.value}
          disabled={props.disabled}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      ) : (
        <input
          class="h-9 min-w-0 w-full rounded-md border border-edge-muted bg-input px-3 text-sm text-ink outline-none focus:border-edge"
          type={props.type ?? 'text'}
          list={props.list}
          value={props.value}
          disabled={props.disabled}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      )}
    </label>
  );
}

export function FieldSelect(props: {
  label: string;
  value: string;
  options: { id: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label class="flex min-w-0 flex-col gap-1 text-xs text-ink-muted">
      <span>{props.label}</span>
      <select
        class="h-9 rounded-md border border-edge-muted bg-input px-2 text-sm text-ink"
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        <option value="">
          {props.options.length ? 'Default' : 'None available'}
        </option>
        <For each={props.options}>
          {(option) => (
            <option value={option.id} disabled={option.disabled}>
              {option.label}
            </option>
          )}
        </For>
      </select>
    </label>
  );
}

export function FieldGrid(props: { children: JSX.Element }) {
  return (
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">{props.children}</div>
  );
}
