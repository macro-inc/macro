import { ScopedPortal } from '@core/component/ScopedPortal';
import ChevronDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { cn, Layer } from '@ui';
import {
  type Component,
  createEffect,
  createSignal,
  For,
  type JSXElement,
  onCleanup,
  Show,
} from 'solid-js';

export type DropdownOption<T> = {
  value: T;
  label: string;
  icon?: JSXElement;
  description?: string;
  disabled?: boolean;
};

type DropdownProps<T> = {
  value: T;
  options: Array<DropdownOption<T>>;
  onChange: (value: T) => void;
  placeholder?: string;
  class?: string;
  /** Optional custom renderer for dropdown items */
  renderOption?: (option: DropdownOption<T>, isSelected: boolean) => JSXElement;
  /** Optional custom renderer for the selected value display */
  renderValue?: (option: DropdownOption<T> | undefined) => JSXElement;
};

export const Dropdown = <T extends string | number>(
  props: DropdownProps<T>
): ReturnType<Component> => {
  const [isOpen, setIsOpen] = createSignal(false);
  let dropdownRef!: HTMLDivElement;
  let buttonRef!: HTMLButtonElement;
  let menuRef!: HTMLDivElement;

  // Close dropdown when clicking outside
  createEffect(() => {
    if (!isOpen()) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef &&
        !dropdownRef.contains(target) &&
        menuRef &&
        !menuRef.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() =>
      document.removeEventListener('mousedown', handleClickOutside)
    );
  });

  const selectedOption = () =>
    props.options.find((opt) => opt.value === props.value);

  const getMenuStyle = () => {
    if (!buttonRef) return {};
    const rect = buttonRef.getBoundingClientRect();
    return {
      position: 'fixed' as const,
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
    };
  };

  const defaultRenderValue = (option: DropdownOption<T> | undefined) => (
    <>
      <Show when={option?.icon}>
        <span class="shrink-0">{option!.icon}</span>
      </Show>
      <span class="flex-1 truncate">
        {option?.label ?? props.placeholder ?? 'Select...'}
      </span>
    </>
  );

  const defaultRenderOption = (
    option: DropdownOption<T>,
    isSelected: boolean
  ) => (
    <>
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <Show when={option.icon}>
          <span class="shrink-0">{option.icon}</span>
        </Show>
        <div class="flex-1 min-w-0">
          <div class="truncate">{option.label}</div>
          <Show when={option.description}>
            <div class="text-xs text-ink-muted truncate">
              {option.description}
            </div>
          </Show>
        </div>
      </div>
      <Show when={isSelected}>
        <CheckIcon class="size-3 shrink-0" />
      </Show>
    </>
  );

  return (
    <div class={props.class ?? ''} ref={dropdownRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class="w-full p-1.5 border border-edge-muted bg-surface text-sm text-ink text-left flex items-center gap-2 hover:bg-hover rounded-sm"
      >
        {props.renderValue?.(selectedOption()) ??
          defaultRenderValue(selectedOption())}
        <ChevronDownIcon class="size-3 text-ink-muted shrink-0" />
      </button>
      <Show when={isOpen()}>
        <ScopedPortal scope="local">
          <Layer depth={2}>
            <div
              ref={menuRef}
              class="z-toast-region border border-edge bg-surface shadow-lg max-h-64 overflow-y-auto p-1"
              style={getMenuStyle()}
            >
              <For each={props.options}>
                {(option) => {
                  const isSelected = () => option.value === props.value;
                  const isDisabled = () => option.disabled ?? false;

                  return (
                    <button
                      type="button"
                      onClick={() => {
                        if (!isDisabled()) {
                          props.onChange(option.value);
                          setIsOpen(false);
                        }
                      }}
                      disabled={isDisabled()}
                      class={cn(
                        'w-full p-1.5 text-sm text-left flex items-center justify-between',
                        isDisabled()
                          ? 'opacity-50 cursor-not-allowed'
                          : isSelected()
                            ? 'bg-active text-ink'
                            : 'hover:bg-hover text-ink'
                      )}
                    >
                      {props.renderOption?.(option, isSelected()) ??
                        defaultRenderOption(option, isSelected())}
                    </button>
                  );
                }}
              </For>
            </div>
          </Layer>
        </ScopedPortal>
      </Show>
    </div>
  );
};
