import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import {
  Switch as KobalteSwitch,
  type SwitchRootProps,
} from '@kobalte/core/switch';
import type { JSX } from 'solid-js';
import { Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

export type ToggleSwitchSize = 'xs' | 'sm' | 'md';
export type ToggleSwitchProps = Omit<
  PolymorphicProps<'div', SwitchRootProps<'div'>>,
  'children'
> & {
  labelClass?: string;
  label?: JSX.Element;
  /** Compact toolbar sizes are xs/sm; use md in settings rows. */
  size?: ToggleSwitchSize;
  controlClass?: string;
};

const SWITCH_SIZES = {
  xs: {
    control: 'h-3.5 w-7',
    thumb: '-left-0.5 -top-px size-3.5 data-checked:translate-x-4',
    pressed:
      'group-active/switch:w-4 data-checked:group-active/switch:translate-x-3.5',
  },
  sm: {
    control: 'h-4 w-8',
    thumb: '-left-0.5 -top-px size-4 data-checked:translate-x-4.5',
    pressed:
      'group-active/switch:w-5 data-checked:group-active/switch:translate-x-3.5',
  },
  md: {
    control: 'h-5 w-10',
    thumb: '-left-0.5 -top-px size-5 data-checked:translate-x-5.5',
    pressed:
      'group-active/switch:w-6 data-checked:group-active/switch:translate-x-4.5',
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
        'group/switch relative inline-flex items-center gap-2 data-disabled:cursor-not-allowed data-disabled:opacity-50',
        local.class
      )}
      defaultChecked={local.defaultChecked}
      onChange={local.onChange}
      disabled={local.disabled}
      checked={local.checked}
      onClick={handleRootClick}
      {...others}
    >
      <KobalteSwitch.Input class="peer sr-only" />
      <KobalteSwitch.Control
        class={cn(
          'relative shrink-0 rounded-full border border-border-secondary bg-border-tertiary transition-colors duration-150 ease-out data-checked:border-accent data-checked:bg-accent data-invalid:border-failure peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none',
          sizing().control,
          local.controlClass
        )}
      >
        <KobalteSwitch.Thumb
          class={cn(
            'absolute rounded-full border border-border-secondary bg-[white] transition-[width,translate] duration-150 ease-out motion-reduce:transition-none',
            sizing().thumb,
            !local.disabled && !others.readOnly && sizing().pressed
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
