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
import { Button } from './Button';

type Size = 'SM' | 'Base';
const sizeClass: Record<Size, string> = {
  SM: 'text-xs',
  Base: 'text-[14px]',
};

export const ToggleSwitch: Component<
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
  const [showFlicker, setShowFlicker] = createSignal(false);

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

    setShowFlicker(true);
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
      class="flex justify-between items-center font-medium gap-1"
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
          }}
          // style={{ 'font-size-adjust': 'ex-height 0.5' }}
        >
          {typeof props.label === 'function' ? props.label() : props.label}
        </KSwitch.Label>
      </Show>

      <div class="relative focus-bracket-within [&:focus-within]:[--focus-border-inset:-3px] w-fit h-fit">
        <KSwitch.Input class="absolute inset-0 !h-full !w-full pointer-events-none" />
        <KSwitch.Control
          class="relative"
          classList={{
            'animate-[flicker_50ms_3_150ms]':
              props.animateFlicker && showFlicker(),
          }}
          onAnimationEnd={() => {
            setShowFlicker(false);
          }}
        >
          <div
            class="relative grid grid-cols-[auto_1fr] auto-cols-auto overflow-clip"
            aria-hidden
          >
            {/* Fake Invisible Node, just to set size of Switch */}
            {/* Firefox: grid-child with square aspect results in zero size, adding min width to minimize clipping  */}
            <div class="h-full min-w-[1.8333333333333333em] aspect-square invisible" />
            <div class="invisible" aria-hidden>
              {/* same button primitive to set correct height */}
              <Button size={props.size}>False</Button>
            </div>

            {/* Visible Interactive, size relative to Fake Invisible Node */}
            <div
              class="absolute inset-0"
              style={{
                'container-type': 'size',
              }}
            >
              <div class="absolute inset-0">
                <div
                  class="h-full w-full transition duration-100"
                  classList={{
                    '-translate-x-[calc(100%-100cqh)]': !checked(),
                    'translate-x-0': checked(),
                  }}
                >
                  <div
                    class="absolute h-full aspect-square right-0 top-0 bg-ink transition duration-100"
                    classList={{
                      'opacity-0': checked(),
                    }}
                  />
                </div>
              </div>
              <div
                class="absolute inset-0 uppercase"
                classList={{
                  [`${sizeClass[props.size || 'Base']}`]: true,
                  'border border-ink/30':
                    props.switchRootClass?.includes('subtle'),
                  'border border-ink':
                    !props.switchRootClass?.includes('subtle'),
                }}
                aria-hidden
              >
                <div class="absolute inset-0">
                  <div
                    class="absolute inset-0 flex justify-center items-center mr-[100cqh] transition-[clip-path] duration-100"
                    classList={{
                      'font-bold bg-ink text-panel':
                        !props.switchRootClass?.includes('subtle'),
                      'font-medium bg-ink/20 text-ink/80':
                        props.switchRootClass?.includes('subtle'),
                    }}
                    style={{
                      'clip-path': `polygon(0% 0%, ${!checked() ? 0 : 100}% 0%, ${!checked() ? 0 : 100}% 100%, 0% 100%)`,
                    }}
                  >
                    {props.trueLabel ?? 'True'}
                  </div>
                  <div
                    class="absolute inset-0 flex justify-center items-center ml-[100cqh] transition-[clip-path] duration-100"
                    classList={{
                      'font-bold text-ink':
                        !props.switchRootClass?.includes('subtle'),
                      'font-medium text-ink/60':
                        props.switchRootClass?.includes('subtle'),
                    }}
                    style={{
                      'clip-path': `polygon(${!checked() ? 0 : 100}% 0%, 100% 0%, 100% 100%, ${!checked() ? 0 : 100}% 100%)`,
                    }}
                  >
                    {props.falseLabel ?? 'False'}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* <KSwitch.Thumb class="relative z-[1]" /> */}
        </KSwitch.Control>
      </div>
    </KSwitch>
  );
};
