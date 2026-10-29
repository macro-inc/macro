import { Switch as KobalteSwitch } from '@kobalte/core/switch';
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

export type ToggleSwitchProps = {
  onChange?: (checked: boolean) => void;
  defaultChecked?: boolean;
  labelClass?: string;
  label?: JSX.Element;
  /**
   * Short text inside the track, beside the thumb. It names the switch when
   * there is no `label`.
   */
  trackLabel?: string;
  disabled?: boolean;
  checked?: boolean;
  /** Visual size. `sm` (default) is the compact toolbar size; `md` is larger,
   *  used in settings rows. */
  size?: 'xs' | 'sm' | 'md';
  class?: string;
  controlClass?: string;
};

const SWITCH_SIZES = {
  xs: {
    control: 'h-3.5 w-5.5',
    thumb: 'top-0.5 left-0.5 h-2.5',
    stretched: 'w-3 data-checked:translate-x-1.5',
    normal: 'w-2.5 data-checked:translate-x-2',
    labelled: {
      text: 'pl-4 pr-1 text-[0.5rem] group-data-checked:pl-1 group-data-checked:pr-4',
      thumb: 'w-2.5 data-checked:left-[calc(100%-0.75rem)]',
    },
  },
  sm: {
    control: 'h-4 w-6',
    thumb: 'top-0.5 left-0.5 h-3',
    stretched: 'w-4 data-checked:translate-x-1',
    normal: 'w-3 data-checked:translate-x-2',
    labelled: {
      text: 'pl-4.5 pr-1.5 text-[0.5625rem] group-data-checked:pl-1.5 group-data-checked:pr-4.5',
      thumb: 'w-3 data-checked:left-[calc(100%-0.875rem)]',
    },
  },
  md: {
    control: 'h-5 w-9',
    thumb: 'top-0.5 left-0.5 h-4',
    stretched: 'w-5 data-checked:translate-x-3',
    normal: 'w-4 data-checked:translate-x-4',
    labelled: {
      text: 'pl-6 pr-2 text-xxs group-data-checked:pl-2 group-data-checked:pr-6',
      thumb: 'w-4 data-checked:left-[calc(100%-1.125rem)]',
    },
  },
} as const;

/**
 * An on/off switch for a setting that applies immediately. If the change
 * needs a save step, use a Checkbox instead.
 *
 * @do Use a switch only when the change takes effect immediately.
 * @do Label the setting in its on-state ("Read receipts", not "Disable read
 *   receipts").
 * @do Use `size="md"` in settings and `size="sm"` in toolbars.
 * @dont Do not put a switch in a form that has a Save button — use a Checkbox.
 * @dont Do not pair a switch with an on/off text label; the control already
 *   says it.
 */
export const ToggleSwitch = (props: ToggleSwitchProps): JSX.Element => {
  const [local, others] = splitProps(props, [
    'defaultChecked',
    'labelClass',
    'onChange',
    'disabled',
    'checked',
    'class',
    'controlClass',
    'label',
    'trackLabel',
    'size',
  ]);
  const sizing = () => SWITCH_SIZES[local.size ?? 'sm'];
  const [isStretched, setIsStretched] = createSignal(false);
  let stretchTimeout: ReturnType<typeof setTimeout> | undefined;

  const triggerStretch = () => {
    setIsStretched(true);
    if (stretchTimeout) clearTimeout(stretchTimeout);
    stretchTimeout = setTimeout(() => setIsStretched(false), 75);
  };

  const handleChange = (checked: boolean) => {
    triggerStretch();
    local.onChange?.(checked);
  };

  // Kobalte's switch root is an inert div — only the control and the label
  // toggle. Forward clicks that land on the root itself (its padding/gap) to
  // the hidden input so the whole component is one hit target.
  const handleRootClick = (event: MouseEvent) => {
    if (event.target !== event.currentTarget) return;
    (event.currentTarget as HTMLElement).querySelector('input')?.click();
  };

  onCleanup(() => {
    if (stretchTimeout) clearTimeout(stretchTimeout);
  });

  return (
    <KobalteSwitch
      class={cn(
        'relative inline-flex items-center gap-2 data-disabled:cursor-not-allowed data-disabled:opacity-50',
        local.class
      )}
      defaultChecked={local.defaultChecked}
      onChange={handleChange}
      disabled={local.disabled}
      checked={local.checked}
      onClick={handleRootClick}
      {...others}
    >
      <KobalteSwitch.Input class="sr-only" />
      <KobalteSwitch.Control
        class={cn(
          'group relative rounded-full bg-ink-muted/40 transition-colors duration-100 data-checked:bg-accent',
          sizing().control,
          local.trackLabel !== undefined && 'inline-flex w-auto items-center',
          local.controlClass
        )}
      >
        <Show when={local.trackLabel}>
          {(text) => (
            <span
              aria-hidden="true"
              class={cn(
                'font-medium leading-none whitespace-nowrap text-ink transition-[padding] duration-100 ease-in-out select-none group-data-checked:text-accent-contrast',
                sizing().labelled.text
              )}
            >
              {text()}
            </span>
          )}
        </Show>
        <KobalteSwitch.Thumb
          class={cn(
            'absolute rounded-full bg-surface transition-all duration-100 ease-in-out',
            sizing().thumb,
            local.trackLabel !== undefined
              ? sizing().labelled.thumb
              : isStretched()
                ? sizing().stretched
                : sizing().normal
          )}
        />
      </KobalteSwitch.Control>
      <Show
        when={local.label != null}
        fallback={
          <Show when={local.trackLabel}>
            {(text) => (
              <KobalteSwitch.Label class="sr-only">
                {text()}
              </KobalteSwitch.Label>
            )}
          </Show>
        }
      >
        <KobalteSwitch.Label class={cn(local.labelClass)}>
          {local.label}
        </KobalteSwitch.Label>
      </Show>
    </KobalteSwitch>
  );
};
