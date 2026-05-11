import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { createSignal, For, mergeProps, Show } from 'solid-js';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Hotkey } from '../../ui/components/Hotkey';
import type { Placement } from '@floating-ui/dom';
import type { JSX, ParentProps }  from 'solid-js';
import { cn, Layer } from '@ui';

const TOOLTIP_DELAY = 250;

export type TooltipProps = ParentProps<{
  tooltip?: JSX.Element | ((close: () => void) => JSX.Element);
  ref?: (el: HTMLDivElement | HTMLSpanElement) => void;
  /** Distance in px between the trigger and the tooltip content. */
  gutter?: number;
  /** Whether the tooltip should flip to stay in the viewport. */
  flip?: boolean | string;
  /** Padding (px) kept between the tooltip and the viewport edge. */
  overflowPadding?: number;
  /** Constrain the tooltip size to fit within the viewport. */
  fitViewport?: boolean;
  /** Padding (px) used when computing the tooltip's max-width. */
  viewportPadding?: number;
  delayOverride?: number;
  placement?: Placement;
  spanMode?: boolean;
  unstyled?: boolean;
  class?: string;
  hide?: boolean;
}>;

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
      gutter: 12,
      flip: true as boolean | string,
      overflowPadding: 16,
      fitViewport: true,
      viewportPadding: 16,
      placement: 'bottom' as Placement,
    },
    props
  );

  const [open, setOpen] = createSignal(false);
  const close = () => setOpen(false);

  function tooltipContent() {
    if (typeof props.tooltip === 'function') {
      return props.tooltip(close);
    }
    return props.tooltip;
  }

  return (
    <KobalteTooltip
      openDelay={TOOLTIP_DELAY}
      closeDelay={props.delayOverride ?? TOOLTIP_DELAY}
      open={open()}
      onOpenChange={setOpen}
      placement={props.placement}
      gutter={props.gutter}
      flip={props.flip}
      overflowPadding={props.overflowPadding}
      fitViewport={props.fitViewport}
    >
      <KobalteTooltip.Trigger
        as={props.spanMode ? 'span' : 'div'}
        class={cn('inline-flex items-center', props.class)}
        ref={(el: HTMLDivElement | HTMLSpanElement) => {
          props.ref?.(el);
        }}
      >
        {props.children}
      </KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content
          style={{
            'max-width': `calc(100vw - ${2 * (props.viewportPadding ?? 0)}px)`,
          }}
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
          {/*<KobalteTooltip.Arrow />*/}
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
}

export function NullTooltip(props: ParentProps<{}>) {
  return (
    <KobalteTooltip openDelay={0}>
      <KobalteTooltip.Trigger as="div">{props.children}</KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content style={{ visibility: 'hidden' }} />
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
}

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
