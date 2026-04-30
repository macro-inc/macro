import type { HotkeyToken } from '@core/hotkey/tokens';
import CorvuTooltip, { type FloatingOptions } from '@corvu/tooltip';
import type { Placement } from '@floating-ui/dom';
import { cn } from '@ui/utils/classname';
import {
  For,
  type JSX,
  mergeProps,
  type ParentProps,
  Show,
  createSignal,
} from 'solid-js';
import { Hotkey } from './Hotkey';
import { Panel } from '@ui';

const TOOLTIP_DELAY = 250;

export type TooltipProps = ParentProps<{
  tooltip?: JSX.Element | ((close: () => void) => JSX.Element);
  placement?: Placement;
  floatingOptions?: FloatingOptions;
  ref?: (el: HTMLDivElement | HTMLSpanElement) => void;
  class?: string;
  delayOverride?: number;
  spanMode?: boolean;
  hide?: boolean;
  unstyled?: boolean;
}>;

/**
 * Tooltip component to wrap some piece of UI with a tooltip.
 * @param props.tooltip - The JSX element to render in the tooltip.
 * @param props.placement - A optional floating ui placement string.
 * @param props.floatingOptions - A optional floating ui options object.
 * @param props.unstyled - When true, removes default styling from the tooltip content.
 * @example
 * <Tooltip tooltip={<div class="text-xs">Hello</div>}>
 *     <DeprecatedButton>Hover over me</DeprecatedButton>
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

  const [open, setOpen] = createSignal(false);
  const close = () => setOpen(false);

  const tooltipContent = () => {
    if (typeof props.tooltip === 'function') {
      return props.tooltip(close);
    }
    return props.tooltip;
  };

  return (
    <CorvuTooltip
      open={open()}
      onOpenChange={setOpen}
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
          <Show when={!props.unstyled} fallback={tooltipContent()}>
            <Panel
              depth={3}
              class="flex items-center justify-center p-1.5 text-ink-muted text-xs wrap-break-word rounded-sm shadow-md shadow-[#000]/05"
            >
              {tooltipContent()}
            </Panel>
          </Show>
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

export type HotkeySequenceStep = {
  token?: HotkeyToken;
  shortcut?: string;
};

export type LabelAndHotKeyProps = {
  label: string;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  hotkeySequence?: HotkeySequenceStep[];
};

export function LabelAndHotKey(props: LabelAndHotKeyProps) {
  const hasSingleHotkey = () =>
    !props.hotkeySequence && (!!props.hotkeyToken || !!props.shortcut);
  const hasSequence = () =>
    !!props.hotkeySequence && props.hotkeySequence.length > 0;
  const hasPadding = () => !hasSingleHotkey() && !hasSequence();

  return (
    <div
      class={cn(
        'flex flex-row items-center space-x-2',
        hasPadding() ? 'px-1' : 'px-0'
      )}
    >
      <div class="text-xs capitalize">{props.label}</div>
      <Show when={hasSequence()}>
        <div class="flex items-center gap-1 ml-auto">
          <For each={props.hotkeySequence}>
            {(step, ndx) => (
              <>
                <div class="text-xxs rounded-sm border border-edge-muted px-1.5 py-0.25">
                  <Hotkey
                    token={step.token}
                    shortcut={step.shortcut}
                    class="flex gap-1"
                  />
                </div>
                <Show when={ndx() < (props.hotkeySequence ?? []).length - 1}>
                  <span class="text-ink-extra-muted">then</span>
                </Show>
              </>
            )}
          </For>
        </div>
      </Show>
      <Show when={hasSingleHotkey()}>
        <div class="text-xxs rounded-sm ml-auto border border-edge-muted px-1.5 py-0.25">
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
