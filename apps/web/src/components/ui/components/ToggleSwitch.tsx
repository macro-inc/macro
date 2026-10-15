import { Switch as KobalteSwitch } from '@kobalte/core/switch';
import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

export type ToggleSwitchProps = {
  onChange?: (checked: boolean) => void;
  defaultChecked?: boolean;
  labelClass?: string;
  label?: JSX.Element;
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
    normal: 'w-2.5 data-checked:translate-x-2',
  },
  sm: {
    control: 'h-4 w-7',
    thumb: 'top-0.5 left-0.5 h-3',
    normal: 'w-3 data-checked:translate-x-3',
  },
  md: {
    control: 'h-5 w-9',
    thumb: 'top-0.5 left-0.5 h-4',
    normal: 'w-4 data-checked:translate-x-4',
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
    'size',
  ]);
  const sizing = () => SWITCH_SIZES[local.size ?? 'sm'];
  // Kobalte's switch root is an inert div — only the control and the label
  // toggle. Forward clicks that land on the root itself (its padding/gap) to
  // the hidden input so the whole component is one hit target.
  const handleRootClick = (event: MouseEvent) => {
    if (event.target !== event.currentTarget) return;
    (event.currentTarget as HTMLElement).querySelector('input')?.click();
  };

  return (
    <KobalteSwitch
      class={cn(
        'relative group/switch inline-flex items-center gap-2 data-disabled:opacity-45 data-disabled:pointer-events-none',
        local.class
      )}
      defaultChecked={local.defaultChecked}
      onChange={local.onChange}
      disabled={local.disabled}
      checked={local.checked}
      onClick={handleRootClick}
      {...others}
    >
      <KobalteSwitch.Input class="sr-only" />
      <KobalteSwitch.Control
        class={cn(
          'relative shrink-0 rounded-full bg-ink/20 ring-1 ring-inset ring-ink/5 transition-[background-color,box-shadow] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] data-checked:bg-accent group-has-focus-visible/switch:ring-2 group-has-focus-visible/switch:ring-edge-focus group-has-focus-visible/switch:ring-offset-2 group-has-focus-visible/switch:ring-offset-panel motion-reduce:transition-none',
          sizing().control,
          local.controlClass
        )}
      >
        <KobalteSwitch.Thumb
          class={cn(
            'absolute rounded-full bg-switch-thumb shadow-[0_1px_2px_oklch(0_0_0/0.2)] transition-transform duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            sizing().thumb,
            sizing().normal
          )}
        />
      </KobalteSwitch.Control>
      <Show when={local.label != null}>
        <KobalteSwitch.Label class={cn(local.labelClass)}>
          {local.label}
        </KobalteSwitch.Label>
      </Show>
    </KobalteSwitch>
  );
};
