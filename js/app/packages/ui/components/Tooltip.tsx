import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { createSignal, For, mergeProps, Show } from 'solid-js';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Hotkey } from '../../ui/components/Hotkey';
import type { Placement } from '@floating-ui/dom';
import type { JSX, ParentProps }  from 'solid-js';
import { cn, Layer } from '@ui';

export type TooltipProps = ParentProps<{
  tooltip?: JSX.Element | ((close: () => void) => JSX.Element);
  ref?: (el: HTMLDivElement | HTMLSpanElement) => void;
  overflowPadding?: number;
  viewportPadding?: number;
  flip?: boolean | string;
  delayOverride?: number;
  fitViewport?: boolean;
  placement?: Placement;
  spanMode?: boolean;
  unstyled?: boolean;
  gutter?: number;
  class?: string;
  hide?: boolean;
}>;

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

const TOOLTIP_DELAY = 250;

/**
 * Tooltip component to wrap some piece of UI with a tooltip.
 * @param props.placement - An optional Kobalte popper placement string.
 * @param props.gutter - Distance between the trigger and the tooltip.
 * @param props.flip - Whether the tooltip should flip to stay in view.
 * @param props.overflowPadding - Padding kept between the tooltip and the viewport.
 * @param props.fitViewport - Constrain the tooltip size to the viewport.
 * @param props.viewportPadding - Padding used when computing max-width.
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
      placement: 'bottom' as Placement,
      flip: true as boolean | string,
      overflowPadding: 16,
      viewportPadding: 16,
      fitViewport: true,
      gutter: 4,
    },
    props
  );

  const [open, setOpen] = createSignal(false);
  const close = () => setOpen(false);

  function tooltipContent() {
    if (typeof props.tooltip === 'function') { return props.tooltip(close); }
    return props.tooltip;
  }

  return (
    <KobalteTooltip
      closeDelay={props.delayOverride ?? TOOLTIP_DELAY}
      overflowPadding={props.overflowPadding}
      fitViewport={props.fitViewport}
      placement={props.placement}
      openDelay={TOOLTIP_DELAY}
      onOpenChange={setOpen}
      gutter={props.gutter}
      flip={props.flip}
      open={open()}
    >
      <KobalteTooltip.Trigger
        ref={(el: HTMLDivElement | HTMLSpanElement) => { props.ref?.(el); }}
        class={cn('inline-flex items-center', props.class)}
        as={props.spanMode ? 'span' : 'div'}
      >
        {props.children}
      </KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content
          style={{ 'max-width': `calc(100vw - ${2 * (props.viewportPadding ?? 0)}px)` }}
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
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
}

export function LabelAndHotKey(props: LabelAndHotKeyProps) {
  const steps = (): HotkeySequenceStep[] => {
    if (props.hotkeySequence?.length) { return props.hotkeySequence; }
    if (props.hotkeyToken || props.shortcut) {
      return [{ token: props.hotkeyToken, shortcut: props.shortcut }];
    }
    return [];
  };

  return (
    <div
      class={cn(
        'flex flex-row items-center space-x-2',
        steps().length === 0 ? 'px-1' : 'px-0'
      )}
    >
      <div class="text-xs capitalize">{props.label}</div>
      <Show when={steps().length > 0}>
        <div class="flex items-center gap-1 ml-auto">
          <For each={steps()}>
            {(step, ndx) => (
              <>
                <Hotkey
                  shortcut={step.shortcut}
                  token={step.token}
                  theme="muted"
                />
                <Show when={ndx() < steps().length - 1}>
                  <span class="text-ink-extra-muted">then</span>
                </Show>
              </>
            )}
          </For>
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
