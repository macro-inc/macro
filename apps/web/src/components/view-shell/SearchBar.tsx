import { TextField } from '@kobalte/core/text-field';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import { mergeRefs } from '@solid-primitives/refs';
import { Button, cn, Hotkey, Surface } from '@ui';
import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';

export type SearchBarProps = Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  'children' | 'class' | 'onInput' | 'type' | 'value'
> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  hotkey?: string;
  class?: string;
  inputClass?: string;
};

export function SearchBar(props: SearchBarProps) {
  const [local, inputProps] = splitProps(props, [
    'label',
    'value',
    'onValueChange',
    'hotkey',
    'class',
    'inputClass',
    'disabled',
    'id',
    'name',
    'readOnly',
    'ref',
    'required',
  ]);

  let input: HTMLInputElement | undefined;
  const clear = () => {
    local.onValueChange('');
    queueMicrotask(() => input?.focus());
  };

  return (
    <Surface
      depth={2}
      class={cn('h-10 w-full min-w-0 rounded-2xl text-ink', local.class)}
      data-search-bar=""
    >
      <TextField
        id={local.id}
        name={local.name}
        value={local.value}
        onChange={local.onValueChange}
        disabled={local.disabled}
        readOnly={local.readOnly}
        required={local.required}
        class="group flex size-full min-w-0 items-center gap-2 px-3"
      >
        <TextField.Label class="sr-only">{local.label}</TextField.Label>
        <MagnifyingGlassIcon
          aria-hidden="true"
          class="size-4 shrink-0 text-ink-extra-muted"
        />
        <TextField.Input
          {...inputProps}
          ref={mergeRefs((element) => (input = element), local.ref)}
          type="search"
          class={cn(
            'min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden',
            local.inputClass
          )}
        />
        <Show when={!local.value && local.hotkey}>
          {(hotkey) => (
            <Hotkey
              shortcut={hotkey()}
              theme="subtle"
              class="shrink-0 group-focus-within:hidden"
            />
          )}
        </Show>
        <Show when={local.value && !local.disabled && !local.readOnly}>
          <Button
            type="button"
            size="sm"
            square
            label="Clear search"
            class="rounded-lg"
            onPointerDown={(event) => event.preventDefault()}
            onClick={clear}
          >
            <XIcon />
          </Button>
        </Show>
      </TextField>
    </Surface>
  );
}
