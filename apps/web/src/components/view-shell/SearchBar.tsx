import { TextField } from '@kobalte/core/text-field';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import { mergeRefs } from '@solid-primitives/refs';
import { Button, cn, Hotkey, Surface } from '@ui';
import type { JSX, JSXElement } from 'solid-js';
import { Show, splitProps } from 'solid-js';

export type SearchBarProps = Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  'children' | 'class' | 'onInput' | 'type' | 'value'
> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  hotkey?: string;
  /**
   * Called after Escape blurs the field without clearing its value. The view
   * can restore keyboard focus to its list.
   */
  onEscape?: () => void;
  /** Replaces the clear action with a close action in collapsible search fields. */
  onClose?: () => void;
  /** Controls shown after the input and before its clear or close action. */
  actions?: JSXElement;
  class?: string;
  inputClass?: string;
};

export function SearchBar(props: SearchBarProps) {
  const [local, inputProps] = splitProps(props, [
    'label',
    'value',
    'onValueChange',
    'hotkey',
    'onEscape',
    'onClose',
    'actions',
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

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;

    event.preventDefault();
    input?.blur();
    local.onEscape?.();
  };

  return (
    <Surface
      depth={2}
      hideBorder
      class={cn(
        'h-10 w-full min-w-0 rounded-full border border-edge-button bg-control text-ink has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-edge-muted',
        local.class
      )}
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
        onKeyDown={onKeyDown}
      >
        <TextField.Label class="sr-only">{local.label}</TextField.Label>
        <MagnifyingGlassIcon
          aria-hidden="true"
          class="size-4 shrink-0 text-ink-extra-muted"
        />
        <div class="relative min-w-0 flex-1">
          <TextField.Input
            {...inputProps}
            ref={mergeRefs((element) => (input = element), local.ref)}
            type="search"
            class={cn(
              'w-full min-w-0 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden',
              local.hotkey &&
                inputProps.placeholder &&
                'placeholder:text-transparent group-focus-within:placeholder:text-ink-placeholder',
              local.inputClass
            )}
          />
          <Show when={!local.value && local.hotkey && inputProps.placeholder}>
            <div
              aria-hidden="true"
              class="pointer-events-none absolute inset-0 flex items-center gap-2 overflow-hidden whitespace-nowrap text-sm text-ink-placeholder group-focus-within:hidden"
            >
              <span class="truncate">{inputProps.placeholder}</span>
              <Hotkey
                shortcut={local.hotkey}
                theme="subtle"
                class="shrink-0"
              />
            </div>
          </Show>
        </div>
        <Show when={!inputProps.placeholder && !local.value && local.hotkey}>
          {(hotkey) => (
            <Hotkey
              shortcut={hotkey()}
              theme="subtle"
              class="shrink-0 group-focus-within:hidden"
            />
          )}
        </Show>
        {local.actions}
        <Show
          when={local.onClose || (local.value && !local.disabled && !local.readOnly)}
        >
          <Button
            type="button"
            size="sm"
            square
            label={local.onClose ? 'Close search' : 'Clear search'}
            class="rounded-lg"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => (local.onClose ?? clear)()}
          >
            <XIcon />
          </Button>
        </Show>
      </TextField>
    </Surface>
  );
}
