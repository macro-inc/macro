import { Switch as KobalteSwitch } from '@kobalte/core/switch';
import { Show, splitProps } from 'solid-js';
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

  return (
    <KobalteSwitch
      class={cn('inline-flex items-center gap-2', local.class)}
      defaultChecked={local.defaultChecked}
      onChange={local.onChange}
      disabled={local.disabled}
      checked={local.checked}
      {...others}
    >
      <KobalteSwitch.Input class="sr-only" />
      <Show when={local.label != null}>
        <KobalteSwitch.Label class={cn('cursor-pointer', local.labelClass)}>
          {local.label}
        </KobalteSwitch.Label>
      </Show>
      <KobalteSwitch.Control class="relative h-6 w-12 rounded-full border border-edge bg-surface transition-colors duration-150 data-checked:border-accent data-checked:bg-accent/50">
        <KobalteSwitch.Thumb class="absolute top-0.75 left-0.75 size-4 rounded-full border border-edge transition-all duration-150 ease-in-out data-checked:translate-x-6 data-checked:border-accent data-checked:bg-accent/50" />
      </KobalteSwitch.Control>
    </KobalteSwitch>
  );
};
