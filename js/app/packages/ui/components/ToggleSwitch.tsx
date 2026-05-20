import { Switch as KSwitch } from '@kobalte/core/switch';
import { Show } from 'solid-js';
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
  return (
    <KSwitch
      class={cn(
        'inline-flex items-center gap-2 font-medium text-[14px]',
        props.disabled && 'opacity-50 cursor-not-allowed',
        props.class
      )}
      checked={props.checked}
      defaultChecked={props.defaultChecked}
      onChange={props.onChange}
      disabled={props.disabled}
    >
      <KSwitch.Input class="sr-only" />
      <Show when={props.label != null}>
        <KSwitch.Label
          class={cn('whitespace-nowrap cursor-pointer', props.labelClass)}
        >
          {props.label}
        </KSwitch.Label>
      </Show>
      <KSwitch.Control class="relative w-8 h-3 touch:w-12 touch:h-8 rounded-full bg-edge transition-colors duration-80 data-[checked]:bg-accent">
        <KSwitch.Thumb class="absolute top-0.5 size-2 touch:size-7 rounded-full bg-surface transition-transform duration-200 ease-out translate-x-0.5 data-[checked]:translate-x-5.5 touch:data-[checked]:translate-x-4.5" />
      </KSwitch.Control>
    </KSwitch>
  );
};
