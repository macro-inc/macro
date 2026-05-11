import { createSignal, For, type JSX, mergeProps, type ParentProps, Show } from 'solid-js';
import CorvuTooltip, { type FloatingOptions } from '@corvu/tooltip';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Hotkey } from '../../ui/components/Hotkey';
import type { Placement } from '@floating-ui/dom';
import { cn, Layer } from '@ui';

const TOOLTIP_DELAY = 250;

export type TooltipProps = ParentProps<{
  tooltip?: JSX.Element | ((close: () => void) => JSX.Element);
  ref?: (el: HTMLDivElement | HTMLSpanElement) => void;
  floatingOptions?: FloatingOptions;
  delayOverride?: number;
  placement?: Placement;
  spanMode?: boolean;
  unstyled?: boolean;
  class?: string;
  hide?: boolean;
}>;

/**
 * Tooltip component to wrap some piece of UI with a tooltip.
 * @param props.floatingOptions - A optional floating ui options object.
 * @param props.placement - A optional floating ui placement string.
 * @param props.unstyled - When true, removes default styling from the tooltip content.
 * @param props.tooltip - The JSX element to render in the tooltip.
 * @example
 * <Tooltip tooltip={<div class="text-xs">Hello</div>}>
 *     <Button>Hover over me</Button>
 * </Tooltip>
 */
export function Tooltip(props: TooltipProps) {
  props = mergeProps(
    {
      floatingOptions: {
        size: {padding: 16, fitViewPort: true },
        shift: { padding: 16 },
        boundary: 'viewport',
        offset: 12,
        flip: true,
      } as FloatingOptions,
      placement: 'bottom' as Placement,
    },
    props
  );

  function padding(){
    let padding = props.floatingOptions?.size?.padding;
    if (typeof padding === 'number') return padding;
    return 0;
  };

  const [open, setOpen] = createSignal(false);
  const close = () => setOpen(false);

  function tooltipContent(){
    if (typeof props.tooltip === 'function') { return props.tooltip(close); }
    return props.tooltip;
  };

  return (
    <CorvuTooltip
      closeDelay={props.delayOverride ?? TOOLTIP_DELAY}
      floatingOptions={props.floatingOptions}
      group={'tooltip-single-group'} /* only allow one open tooltip */
      placement={props.placement}
      openDelay={TOOLTIP_DELAY}
      onOpenChange={setOpen}
      open={open()}
    >
      <CorvuTooltip.Trigger
        class={cn('inline-flex items-center', props.class)}
        as={props.spanMode ? 'span' : 'div'}
        ref={(el) => { props.ref?.(el); }}
      >
        {props.children}
      </CorvuTooltip.Trigger>
      <CorvuTooltip.Portal>
        <CorvuTooltip.Content
          style={{ 'max-width': `calc(100vw - ${2 * padding()}px)` }}
          hidden={props.hide}
          class="z-tool-tip"
        >
          <Show when={!props.unstyled} fallback={tooltipContent()}>
            <Layer depth={3}>
              <div class="border border-edge bg-panel flex items-center justify-center p-1.5 text-ink-muted text-xs wrap-break-word rounded-sm shadow-md shadow-[#000]/5">
                {tooltipContent()}
              </div>
            </Layer>
          </Show>
          {/* Note disabling arrows for now. I think its more on-brand - seamus */}
          {/*<CorvuTooltip.Arrow />*/}
        </CorvuTooltip.Content>
      </CorvuTooltip.Portal>
    </CorvuTooltip>
  );
}

export function NullTooltip(props: ParentProps<{}>){
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
  hotkeySequence?: HotkeySequenceStep[];
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  label: string;
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
                <div class="text-xxs rounded-sm border border-edge-muted px-1.5 py-px">
                  <Hotkey
                    shortcut={step.shortcut}
                    token={step.token}
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
        <div class="text-xxs rounded-sm ml-auto border border-edge-muted px-1.5 py-px">
          {props.hotkeyToken
            ? Hotkey({ token: props.hotkeyToken, class: 'flex gap-1' })
            : Hotkey({ shortcut: props.shortcut, class: 'flex gap-1' })
          }
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
              hotkeyToken={props.tooltip.hotkeyToken}
              label={props.tooltip.label}
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
