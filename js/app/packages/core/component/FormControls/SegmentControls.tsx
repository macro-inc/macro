import { Tooltip } from '@core/component/Tooltip';
import {
  SegmentedControl as KSegmentedControl,
  type SegmentedControlRootProps,
} from '@kobalte/core/segmented-control';
import {
  createEffect,
  createSignal,
  For,
  Match,
  type ParentComponent,
  Show,
  Switch,
} from 'solid-js';
import { ToggleButton } from './ToggleButton';

type Size = 'SM' | 'Base';
const sizeClass: Record<Size, string> = {
  SM: 'text-xs',
  Base: 'text-[14px]',
};

export const SegmentedControl: ParentComponent<
  {
    list: string[] | { value: string; label: string; tooltip?: string }[];
    value?: string;
    label?: string;
    labelClass?: string;
    labelPlacement?: 'left' | 'right';
    itemLabelClass?: string;
    size?: 'SM' | 'Base';
  } & SegmentedControlRootProps
> = (props) => {
  const [value, setValue] = createSignal(
    props.defaultValue ??
      (typeof props.list[0] === 'object' ? props.list[0].value : props.list[0])
  );

  createEffect(() => {
    if (props.value !== undefined) {
      setValue(props.value);
    }
  });

  const onChange = (newValue: string) => {
    if (props.value === undefined) {
      setValue(newValue);
    }
    props.onChange?.(newValue);
  };

  return (
    <KSegmentedControl
      class="flex gap-3 text-sm"
      classList={{
        [`justify-between`]: !!props.label,
        'flex-row-reverse': props.labelPlacement === 'right',
        'opacity-50 cursor-not-allowed': props.disabled,
      }}
      value={value()}
      onChange={onChange}
      disabled={props.disabled}
    >
      <Show when={props.label}>
        <KSegmentedControl.Label
          class="self-center text-xs font-medium leading-none"
          classList={{
            [`${sizeClass[props.size || 'Base']}`]: true,
            [`${props.labelClass}`]: !!props.labelClass,
          }}
          // style={{ 'font-size-adjust': 'ex-height 0.5' }}
        >
          {props.label}
        </KSegmentedControl.Label>
      </Show>
      <div class="" role="presentation">
        {/* <KSegmentedControl.Indicator class="" /> */}
        <div class="flex" role="presentation">
          <For each={props.list}>
            {(item) => {
              const itemValue = () =>
                typeof item === 'object' ? item.value : item;
              const itemLabel = () =>
                typeof item === 'object' ? item.label : item;
              const tooltip = (): undefined | string =>
                typeof item === 'object' ? item.tooltip : undefined;
              return (
                <KSegmentedControl.Item
                  value={itemValue()}
                  class="relative focus-bracket-within [&:focus-within]:[--focus-border-inset:-3px] ml-[-1px] first:ml-0"
                  disabled={props.disabled}
                >
                  <KSegmentedControl.ItemInput class="absolute inset-0 !h-full !w-full pointer-events-none" />
                  <KSegmentedControl.ItemLabel class="flex">
                    {/* <div
                    class="flex justify-center items-center border border-ink p-1 font-bold uppercase font-mono text-[11px]"
                    classList={{
                      // [`${sizeClass[props.size || 'Base']}`]: true,
                      'bg-ink text-panel': value() === item,
                      'text-ink': value() !== item,
                      [`${props.itemLabelClass}`]: !!props.itemLabelClass,
                      // 'animate-[flicker_50ms_2]': showFlicker(),
                    }}
                    // onAnimationEnd={() => {
                    //   setShowFlicker(false);
                    // }}
                  >
                    {item}
                  </div> */}
                    <Switch>
                      <Match when={tooltip()}>
                        <Tooltip tooltip={tooltip()}>
                          <ToggleButton
                            size={props.size}
                            pressed={value() === itemValue()}
                            animateFlickerOnDeactivate={false}
                            tabIndex={-1}
                            as="div"
                            disabled={props.disabled}
                          >
                            {itemLabel()}
                          </ToggleButton>
                        </Tooltip>
                      </Match>
                      <Match when={!tooltip()}>
                        <ToggleButton
                          size={props.size}
                          pressed={value() === itemValue()}
                          animateFlickerOnDeactivate={false}
                          tabIndex={-1}
                          as="div"
                          disabled={props.disabled}
                        >
                          {itemLabel()}
                        </ToggleButton>
                      </Match>
                    </Switch>
                  </KSegmentedControl.ItemLabel>
                </KSegmentedControl.Item>
              );
            }}
          </For>
        </div>
      </div>
    </KSegmentedControl>
  );
};
