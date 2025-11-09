import { activeTextEditorSignal } from '@block-canvas/signal/toolManager';
import { clamp } from '@block-canvas/util/math';
import { type Vector2, vec2 } from '@block-canvas/util/vector2';
import CaretDown from '@icon/regular/caret-down.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import {
  type Component,
  type ComponentProps,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DropdownMenuContent, MenuItem } from './Menu';
import { Tooltip } from './Tooltip';

export type DropdownPreset = {
  value: string;
  displayName?: JSX.Element;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

type SlidableNumberInput = ComponentProps<'div'> & {
  label?: string;
  labelPosition?: 'top' | 'left';
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  inputChanged: (newValue: string) => void;
  onSlideStart?: () => void;
  onSlidePreview?: (newValue?: string) => void;
  onSlideEnd?: (newValue?: string) => void;
  currentValue: string;
  presets: DropdownPreset[];
  showPresets?: boolean;
  isSlidable?: boolean; // If true, must have a numerical range
  width?: 'sm' | 'md' | 'lg' | number;
  range?: Vector2; // Numerical range
  hideValue?: boolean;
  fullIcon?: boolean;
  flip?: boolean;
  tooltip?: string;
};

const OptionalTooltipWrapper = (props: {
  children: JSX.Element;
  tooltip?: string;
}) => {
  if (props.tooltip) {
    return <Tooltip tooltip={props.tooltip}>{props.children}</Tooltip>;
  }
  return <>{props.children}</>;
};

export type SlidableNumberInputProps = SlidableNumberInput;

export function SlidableNumberInput(props: SlidableNumberInputProps) {
  const [dropdownOpen, setDropdownOpen] = createSignal<boolean>(false);
  const [mouseDownPos, setMouseDownPos] = createSignal<Vector2>();
  const [currentValue, setCurrentValue] = createSignal<string>(
    props.currentValue
  );
  const [mouseDownValue, setMouseDownValue] = createSignal<string>();
  const [, setActiveTextEditor] = activeTextEditorSignal;

  function pointerMove(e: PointerEvent) {
    if (!mouseDownPos()) return;
    const difference = mouseDownPos()?.subtract(vec2(e.clientX, e.clientY));
    const angle = difference?.angle();
    // Dragging left/down reduces value while dragging right/up increases value
    const direction =
      angle && (angle >= Math.PI / 4 || angle <= (-3 * Math.PI) / 4) ? -1 : 1;

    if (props.range) {
      let currentWithRange = Number.parseInt(currentValue());
      // If current value is mixed (i.e. multiselect), start from midpoint of valid range
      if (Number.isNaN(currentWithRange))
        currentWithRange = Math.round((props.range!.y - props.range!.x) / 2);
      setMouseDownValue(
        clamp(
          // 150 is an arbitrary value adjusted for sliding feel and control
          currentWithRange -
            Math.round(
              ((difference?.mag() ?? 0) * direction) /
                (100 / (props.range.y - props.range.x))
            ),
          props.range.x,
          props.range.y
        ).toString()
      );
      props.onSlidePreview?.(mouseDownValue());
    } else {
      let currentWithPreset = props.presets.findIndex(
        (preset) => preset.value === props.currentValue
      );
      if (currentWithPreset < -1)
        currentWithPreset = Number.parseInt(
          props.presets[Math.round(props.presets.length / 2)].value
        );
      setMouseDownValue(
        props.presets[
          clamp(
            currentWithPreset -
              Math.round(
                ((difference?.mag() ?? 0) * direction) /
                  (150 / props.presets.length)
              ),
            0,
            props.presets.length - 1
          )
        ].value
      );
    }
  }

  function pointerUp() {
    if (!mouseDownPos()) return;
    const mouseDownVal = mouseDownValue();
    if (mouseDownVal) {
      setCurrentValue(mouseDownVal);
      if (props.onSlideEnd) {
        props.onSlideEnd(mouseDownVal);
      } else {
        props.inputChanged(mouseDownVal);
      }
      setMouseDownValue();
    }
    setMouseDownPos();
  }

  onMount(() => {
    document.addEventListener('pointermove', pointerMove);
    document.addEventListener('pointerup', pointerUp);
  });
  onCleanup(() => {
    document.removeEventListener('pointermove', pointerMove);
    document.removeEventListener('pointerup', pointerUp);
  });

  // Keep current value updated to changing props
  createEffect(() => {
    setCurrentValue(props.currentValue);
  });

  return (
    <div
      class={`flex ${
        props.labelPosition === 'top' ? `flex-col` : `flex-row items-center`
      } justify-items-center`}
    >
      <Show when={props.label}>
        <div
          class={`text-[0.67rem] opacity-75 truncate ${
            props.labelPosition === 'left' && `w-28 truncate`
          } mb-1`}
        >
          {props.label}&nbsp
        </div>
      </Show>
      <OptionalTooltipWrapper tooltip={props.tooltip}>
        <div
          class={`${
            props.labelPosition === 'top' &&
            (props.width === 'sm'
              ? `w-22`
              : props.width === 'lg'
                ? `w-48`
                : `w-32`)
          } flex flex-row items-center bg-input rounded px-1.5 h-8`}
        >
          <Dynamic
            component={props.icon}
            class={`fill-ink-muted 'ml-.5 mr-1 min-w-5 ${
              props.isSlidable && 'cursor-ew-resize'
            }`}
            style={{
              'overflow-clip-margin': 'content-box',
              transform: props.flip ? 'rotateY(180deg)' : '',
            }}
            width={18}
            height={18}
            onmousedown={(e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              if (props.isSlidable) setMouseDownPos(vec2(e.clientX, e.clientY));
              if (props.isSlidable) props.onSlideStart?.();
            }}
          />
          <Show when={!props.fullIcon}>
            <div
              class={`${
                props.labelPosition === 'top'
                  ? props.width === 'sm'
                    ? `w-18`
                    : props.width === 'lg'
                      ? `w-44`
                      : `w-28`
                  : `max-w-18`
              } text-ink text-nowrap overflow-hidden cursor-text`}
              contenteditable
              onFocus={() => {
                setActiveTextEditor(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                const innerText = e.currentTarget.innerText;
                var regExp = /[a-zA-Z]/g;
                if (regExp.test(innerText)) {
                  const matchingPreset = props.presets.find(
                    (p) => p.displayName === innerText
                  );
                  if (matchingPreset) props.inputChanged(matchingPreset.value);
                } else props.inputChanged(e.currentTarget.innerText);
                setActiveTextEditor(false);
              }}
            >
              {mouseDownValue() ?? currentValue()}
            </div>
          </Show>
          <Show when={props.showPresets}>
            <div class="flex h-full items-center ml-auto mr-.5">
              <DropdownMenu
                open={dropdownOpen()}
                onOpenChange={setDropdownOpen}
                placement={'bottom'}
                gutter={8}
              >
                <DropdownMenu.Trigger class="dropdown-menu__trigger">
                  <div class="w-3 h-5 ml-1.5 flex items-center text-ink-muted">
                    <CaretDown width={12} height={12} />
                  </div>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenuContent>
                    <For each={props.presets}>
                      {(preset, _index) => (
                        <MenuItem
                          text={
                            <div class="flex w-full gap-2 justify-between">
                              <span>{preset.displayName}</span>
                              <span class="text-ink-extra-muted">
                                {preset.value}
                              </span>
                            </div>
                          }
                          icon={
                            preset.icon &&
                            (() => {
                              return (
                                <Dynamic
                                  component={preset.icon}
                                  class="w-4 h-4"
                                  classList={{
                                    'rotate-y-180': props.flip,
                                  }}
                                />
                              );
                            })
                          }
                          onClick={() => {
                            props.inputChanged(preset.value);
                            setDropdownOpen(false);
                          }}
                        />
                      )}
                    </For>
                  </DropdownMenuContent>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </div>
          </Show>
        </div>
      </OptionalTooltipWrapper>
    </div>
  );
}
