import type { HotkeyToken } from '@core/hotkey/tokens';
import CorvuTooltip, { type FloatingOptions } from '@corvu/tooltip';
import type { Placement } from '@floating-ui/dom';
import { type JSX, mergeProps, type ParentProps, Show } from 'solid-js';
import { Hotkey } from './Hotkey';

const TOOLTIP_DELAY = 250;

export type TooltipProps = ParentProps<{
  tooltip: JSX.Element;
  placement?: Placement;
  floatingOptions?: FloatingOptions;
  ref?: (el: HTMLDivElement | HTMLSpanElement) => void;
  class?: string;
  delayOverride?: number;
  spanMode?: boolean;
  hide?: boolean;
}>;

/**
 * Tooltip component to wrap some piece of UI with a tooltip.
 * @param props.tooltip - The JSX element to render in the tooltip.
 * @param props.placement - A optional floating ui placement string.
 * @param props.floatingOptions - A optional floating ui options object.
 * @example
 * <Tooltip tooltip={<div class="text-xs">Hello</div>}>
 *     <Button>Hover over me</Button>
 * </Tooltip>
 */
export function Tooltip(props: TooltipProps) {
  props = mergeProps(
    {
      placement: 'bottom' as Placement,
      floatingOptions: {
        offset: 12,
        flip: true,
        shift: {
          padding: 16,
        },
        size: {
          padding: 16,
          fitViewPort: true,
        },
        boundary: 'viewport',
      } as FloatingOptions,
    },
    props
  );

  const padding = () => {
    let padding = props.floatingOptions?.size?.padding;
    if (typeof padding === 'number') return padding;
    return 0;
  };

  return (
    <CorvuTooltip
      placement={props.placement}
      floatingOptions={props.floatingOptions}
      group={'tooltip-single-group'} // hardcoding implies we only allow one tooltip to be open at a time throughout app
      openDelay={TOOLTIP_DELAY}
      closeDelay={props.delayOverride ?? TOOLTIP_DELAY}
    >
      <CorvuTooltip.Trigger
        as={props.spanMode ? 'span' : 'div'}
        ref={(el) => {
          props.ref?.(el);
        }}
        class={props.class}
      >
        {props.children}
      </CorvuTooltip.Trigger>
      <CorvuTooltip.Portal>
        <CorvuTooltip.Content
          hidden={props.hide}
          class="z-tool-tip"
          style={{
            'max-width': `calc(100vw - ${2 * padding()}px)`,
          }}
        >
          <div class="flex items-center justify-center bg-ink p-1.5 text-panel rounded-sm text-xs wrap-break-word">
            {props.tooltip}
          </div>
          {/* Note disabling arrows for now. I think its more on-brand - seamus */}
          {/*<CorvuTooltip.Arrow />*/}
        </CorvuTooltip.Content>
      </CorvuTooltip.Portal>
    </CorvuTooltip>
  );
}

export const NullTooltip = (props: ParentProps<{}>) => {
  return (
    <CorvuTooltip group={'tooltip-single-group'} openDelay={0}>
      <CorvuTooltip.Trigger as="div">{props.children}</CorvuTooltip.Trigger>
      <CorvuTooltip.Portal>
        <CorvuTooltip.Content style={{ visibility: 'hidden' }} />
      </CorvuTooltip.Portal>
    </CorvuTooltip>
  );
};

export type LabelAndHotKeyProps = {
  label: string;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
};

export function LabelAndHotKey(props: LabelAndHotKeyProps) {
  return (
    <div
      class={`flex flex-row items-center space-x-2 ${props.hotkeyToken || props.shortcut ? 'px-0' : 'px-1'}`}
    >
      <div class="text-xs capitalize">{props.label}</div>
      <Show when={props.hotkeyToken || props.shortcut}>
        <div class="text-[0.625rem] text-page ml-auto border border-edge-muted/30 px-1.5 py-0.25 rounded-xs">
          {props.hotkeyToken
            ? Hotkey({ token: props.hotkeyToken, class: 'flex gap-1' })
            : Hotkey({ shortcut: props.shortcut, class: 'flex gap-1' })}
        </div>
      </Show>
    </div>
  );
}

export function TooltipWrapper(props: {
  tooltip?: LabelAndHotKeyProps;
  children: JSX.Element;
}) {
  if (props.tooltip) {
    return (
      <Tooltip
        tooltip={
          <div class="flex flex-col">
            <LabelAndHotKey
              label={props.tooltip.label}
              hotkeyToken={props.tooltip.hotkeyToken}
            />
          </div>
        }
      >
        {props.children}
      </Tooltip>
    );
  }
  return props.children;
}
