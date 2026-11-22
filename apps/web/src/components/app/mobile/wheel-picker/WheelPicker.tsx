import { cn } from '@ui/utils/classname';
import { For, type ParentProps, Show } from 'solid-js';
import { createWheelColumn } from './create-wheel-column';
import {
  WHEEL_LOOP_COPIES,
  WHEEL_PADDING,
  WHEEL_ROW_HEIGHT,
  WHEEL_VISIBLE_ROWS,
  type WheelOption,
  wheelRowStyle,
} from './wheel-values';
import './wheel-picker.css';

/** One fixed band spans the group while independent columns scroll beneath it. */
export function WheelPicker(
  props: ParentProps<{
    label?: string;
    trailingLabel?: string;
  }>
) {
  return (
    <div
      class={cn(
        'wheel-picker',
        props.trailingLabel && 'wheel-picker-with-label'
      )}
      role="group"
      aria-label={props.label}
      style={{
        '--wheel-row-height': `${WHEEL_ROW_HEIGHT}px`,
        '--wheel-visible-rows': WHEEL_VISIBLE_ROWS,
      }}
    >
      <div class="wheel-picker-band" aria-hidden="true" />
      {props.children}
      <Show when={props.trailingLabel}>
        <span class="wheel-picker-label" aria-live="polite">
          {props.trailingLabel}
        </span>
      </Show>
    </div>
  );
}

export function WheelColumn(props: {
  label: string;
  options: readonly WheelOption[];
  value: string;
  onChange: (value: string) => void;
  loop?: boolean;
  disabled?: boolean;
  width: number;
  align?: 'start' | 'center';
}) {
  let element: HTMLDivElement | undefined;
  const model = createWheelColumn({
    options: () => props.options,
    value: () => props.value,
    loop: () => props.loop ?? false,
    disabled: () => props.disabled ?? false,
    element: () => element,
    onChange: (value) => props.onChange(value),
  });
  const rows = () =>
    Array.from(
      { length: props.options.length * (props.loop ? WHEEL_LOOP_COPIES : 1) },
      (_, index) => index
    );
  return (
    <div
      ref={element}
      class="wheel-picker-column"
      role="spinbutton"
      tabIndex={props.disabled ? -1 : 0}
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, props.options.length - 1)}
      aria-valuenow={model.selectedIndex()}
      aria-valuetext={props.options[model.selectedIndex()]?.label}
      aria-disabled={props.disabled}
      data-corvu-no-drag=""
      style={{
        width: `${props.width}px`,
        'padding-block': `${WHEEL_PADDING * WHEEL_ROW_HEIGHT}px`,
      }}
      onScroll={model.scroll}
      onPointerDown={model.pointerDown}
      onTouchStart={model.touchStart}
      onKeyDown={model.keyDown}
    >
      <For each={rows()}>
        {(index) => (
          <div
            aria-hidden="true"
            class="wheel-picker-row"
            style={{
              ...wheelRowStyle(index - model.state.position),
              'justify-content': props.align === 'start' ? 'start' : 'center',
            }}
            onClick={() => {
              if (props.disabled) return;
              model.choose(index);
              element?.focus({ preventScroll: true });
            }}
          >
            {props.options[index % props.options.length]?.label}
          </div>
        )}
      </For>
    </div>
  );
}
