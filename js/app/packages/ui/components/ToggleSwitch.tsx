import { Switch as KobalteSwitch } from '@kobalte/core/switch';
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, Show, splitProps } from 'solid-js';
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
  size?: 'sm' | 'md';
  class?: string;
};

const SWITCH_SIZES = {
  sm: {
    control: 'h-4 w-6',
    thumb: 'top-0.5 left-0.5 h-3',
    stretched: 'w-4 data-checked:translate-x-1',
    normal: 'w-3 data-checked:translate-x-2',
  },
  md: {
    control: 'h-5 w-9',
    thumb: 'top-0.5 left-0.5 h-4',
    stretched: 'w-5 data-checked:translate-x-3',
    normal: 'w-4 data-checked:translate-x-4',
  },
} as const;

export const ToggleSwitch = (props: ToggleSwitchProps): JSX.Element => {
  const [local, others] = splitProps(props, [
    'defaultChecked',
    'labelClass',
    'onChange',
    'disabled',
    'checked',
    'class',
    'label',
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

  onCleanup(() => {
    if (stretchTimeout) clearTimeout(stretchTimeout);
  });

  return (
    <KobalteSwitch
      class={cn('inline-flex items-center gap-2', local.class)}
      defaultChecked={local.defaultChecked}
      onChange={handleChange}
      disabled={local.disabled}
      checked={local.checked}
      {...others}
    >
      <KobalteSwitch.Input class="sr-only" />
      <KobalteSwitch.Control
        class={cn(
          'relative rounded-full bg-ink-muted/40 transition-colors duration-100 data-checked:bg-accent',
          sizing().control
        )}
      >
        <KobalteSwitch.Thumb
          class={cn(
            'absolute rounded-full bg-surface transition-all duration-100 ease-in-out',
            sizing().thumb,
            isStretched() ? sizing().stretched : sizing().normal
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
