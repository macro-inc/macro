import {
  Switch as KSwitch,
  type SwitchRootOptions,
} from '@kobalte/core/switch';
import {
  type Component,
  createEffect,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';

type Size = 'SM' | 'Base';
const sizeClass: Record<Size, string> = {
  SM: 'text-xs',
  Base: 'text-[14px]',
};

export const MiniToggleSwitch: Component<
  {
    label?: (() => JSX.Element) | string;
    labelPlacement?: 'left' | 'right';
    labelClass?: string;
    switchRootClass?: string;
    size?: 'SM' | 'Base';
    compact?: boolean;
    activeTrackClass?: string;
    disabled?: boolean;
    trueLabel?: string;
    falseLabel?: string;
  } & SwitchRootOptions
> = (props) => {
  const [checked, setChecked] = createSignal(props.checked);

  let init = true;
  createEffect((prevChecked) => {
    const checkedVal = checked();

    if (init) {
      init = false;
      return checkedVal;
    }
    if (checkedVal === prevChecked) {
      return checkedVal;
    }
    if (checkedVal === false) {
      return checkedVal;
    }
    return checkedVal;
  });

  createEffect(() => {
    if (props.checked !== undefined) {
      setChecked(props.checked);
    }
  });

  const onChange = (isChecked: boolean) => {
    if (props.checked === undefined) {
      setChecked(isChecked);
    }
    props.onChange?.(isChecked);
  };

  return (
    <KSwitch
      class="flex justify-between items-center font-medium gap-2"
      classList={{
        [`${sizeClass[props.size || 'Base']}`]: true,
        [`${props.switchRootClass}`]: !!props.switchRootClass,
        'flex-row-reverse': props.labelPlacement === 'right',
        'opacity-50': props.disabled,
      }}
      checked={checked()}
      onChange={onChange}
      disabled={props.disabled}
    >
      <Show when={props.label}>
        <KSwitch.Label
          class={props.labelClass}
          classList={{
            [`${sizeClass[props.size || 'Base']}`]: true,
            'whitespace-nowrap': true,
          }}
        >
          {typeof props.label === 'function' ? props.label() : props.label}
        </KSwitch.Label>
      </Show>

      <div class="relative size-fit rounded-full focus-within:bg-active">
        <KSwitch.Input class="absolute inset-0 size-full! pointer-events-none" />
        <KSwitch.Control class="relative">
          <div
            class="relative rounded-full transition-colors duration-80"
            classList={{
              'w-8 h-3 touch:w-12 touch:h-8': !props.compact,
              'w-6 h-2.5': !!props.compact,
              'bg-edge': !checked(),
              [props.activeTrackClass ?? 'bg-accent']: checked(),
            }}
            aria-hidden
          >
            <div
              class="absolute top-0.5 rounded-full bg-surface transition-transform duration-200 ease-out"
              classList={{
                'size-2 touch:size-7': !props.compact,
                'size-1.5': !!props.compact,
                'translate-x-0.5': !checked(),
                'translate-x-5.5 touch:translate-x-4.5':
                  !props.compact && checked(),
                'translate-x-4': !!props.compact && checked(),
              }}
            />
          </div>
        </KSwitch.Control>
      </div>
    </KSwitch>
  );
};
