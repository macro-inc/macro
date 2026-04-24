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
    animateFlicker?: boolean;
    animateFlickerOnDeactivate?: boolean;
    size?: 'SM' | 'Base';
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
    if (checkedVal === prevChecked) return checkedVal;
    if (props.animateFlickerOnDeactivate === false && checkedVal === false) {
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
        'opacity-50 cursor-not-allowed': props.disabled,
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
            'cursor-not-allowed': props.disabled,
            'whitespace-nowrap': true,
          }}
        >
          {typeof props.label === 'function' ? props.label() : props.label}
        </KSwitch.Label>
      </Show>

      <div class="relative focus-bracket-within focus-within:[--focus-border-inset:-3px] w-fit h-fit">
        <KSwitch.Input class="absolute inset-0 h-full! w-full! pointer-events-none" />
        <KSwitch.Control class="relative">
          <div
            class="relative w-8 h-3 rounded-full transition-colors duration-80"
            classList={{
              'bg-edge': !checked(),
              'bg-accent': checked(),
            }}
            aria-hidden
          >
            {/* Toggle thumb */}
            <div
              class="absolute top-0.5 w-2 h-2 rounded-full bg-panel transition-transform duration-200 ease-click"
              classList={{
                'translate-x-0.5': !checked(),
                'translate-x-5.5': checked(),
              }}
            />
          </div>
        </KSwitch.Control>
      </div>
    </KSwitch>
  );
};
