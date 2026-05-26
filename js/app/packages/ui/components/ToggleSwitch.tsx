import { Switch as KobalteSwitch } from '@kobalte/core/switch';
import { Show, createSignal, onCleanup, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import type { JSX } from 'solid-js';

export type ToggleSwitchProps = {
  onChange?: (checked: boolean) => void;
  defaultChecked?: boolean;
  labelClass?: string;
  label?: JSX.Element;
  disabled?: boolean;
  checked?: boolean;
  class?: string;
};

export const ToggleSwitch = (props: ToggleSwitchProps): JSX.Element => {
  const [local, others] = splitProps(props, [
    'defaultChecked',
    'labelClass',
    'onChange',
    'disabled',
    'checked',
    'class',
    'label',
  ]);
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
      <KobalteSwitch.Control class="relative h-4 w-6 rounded-full bg-edge transition-colors duration-100 data-checked:bg-accent">
        <KobalteSwitch.Thumb
          class={cn(
            'absolute top-0.5 left-0.5 h-3 rounded-full bg-surface transition-all duration-100 ease-in-out',
            isStretched()
              ? 'w-4 data-checked:translate-x-1'
              : 'w-3 data-checked:translate-x-2',
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
