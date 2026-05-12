import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Hotkey } from '../../ui/components/Hotkey';
import type { Placement } from '@floating-ui/dom';
import type { JSX, ParentProps } from 'solid-js';
import { For, Show } from 'solid-js';
import { cn, Surface } from '@ui';

export type TooltipProps = ParentProps<SharedTooltipProps & (LabelVariantProps | TooltipVariantProps)>;

type SharedTooltipProps = {
  onOpenChange?: (open: boolean) => void;
  ref?: (el: HTMLElement) => void;
  placement?: Placement;
  as?: 'div' | 'span';
  open?: boolean;
  class?: string;
};

export type LabelAndHotKeyProps = {
  hotkeySequence?: HotkeySequenceStep[];
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  label: string;
};

type LabelVariantProps = {
  hotkeySequence?: HotkeySequenceStep[];
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  tooltip?: never;
  label: string;
};

export type HotkeySequenceStep = {
  token?: HotkeyToken;
  shortcut?: string;
};

type TooltipVariantProps = {
  hotkeySequence?: never;
  tooltip: JSX.Element;
  hotkeyToken?: never;
  shortcut?: never;
  label?: never;
};

const DEFAULT_PLACEMENT: Placement = 'bottom';
const TOOLTIP_OVERFLOW_PADDING = 16;
const TOOLTIP_VIEWPORT_PADDING = 16;
const TOOLTIP_FIT_VIEWPORT = true;
const TOOLTIP_GUTTER = 4;
const TOOLTIP_DELAY = 250;
const TOOLTIP_FLIP = true;

export function LabelAndHotKey(props: LabelAndHotKeyProps) {
  const steps = (): HotkeySequenceStep[] => {
    if (props.hotkeySequence?.length) { return props.hotkeySequence; }
    if (props.hotkeyToken || props.shortcut) { return [{ token: props.hotkeyToken, shortcut: props.shortcut }]; }
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
                  theme="subtle"
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

/**
 * A hover-engaged tooltip with built-in chrome.
 *
 * Pick the content shape that fits:
 * - `tooltip`: arbitrary JSX/string content. For multi-row hotkey lists,
 *   compose `<LabelAndHotKey />` rows inside a `<div class="flex flex-col">`.
 * - `label` (+ optional `hotkeyToken` / `shortcut` / `hotkeySequence`):
 *   single row with an optional hotkey badge.
 *
 * For rich, interactive hover content (e.g. user cards with click
 * affordances), reach for `HoverCard`. For click-engaged surfaces, use
 * `Popover`.
 *
 * @example
 * <Tooltip tooltip="Close"><Button>X</Button></Tooltip>
 *
 * <Tooltip label="Zoom" hotkeyToken={TOKENS.canvas.zoomInTool}>
 *   <Button>Zoom</Button>
 * </Tooltip>
 */
export function Tooltip(props: TooltipProps) {
  const content = (): JSX.Element | undefined => {
    if (props.label !== undefined) {
      return (
        <LabelAndHotKey
          hotkeySequence={props.hotkeySequence}
          hotkeyToken={props.hotkeyToken}
          shortcut={props.shortcut}
          label={props.label}
        />
      );
    }
    return props.tooltip;
  };

  return (
    <KobalteTooltip
      placement={props.placement ?? DEFAULT_PLACEMENT}
      overflowPadding={TOOLTIP_OVERFLOW_PADDING}
      fitViewport={TOOLTIP_FIT_VIEWPORT}
      onOpenChange={props.onOpenChange}
      closeDelay={TOOLTIP_DELAY}
      openDelay={TOOLTIP_DELAY}
      gutter={TOOLTIP_GUTTER}
      flip={TOOLTIP_FLIP}
      open={props.open}
    >
      <KobalteTooltip.Trigger
        class={cn('inline-flex items-center', props.class)}
        ref={(el: HTMLElement) => { props.ref?.(el); }}
        as={props.as ?? 'div'}
      >
        {props.children}
      </KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content
          style={{ 'max-width': `calc(100vw - ${2 * TOOLTIP_VIEWPORT_PADDING}px)` }}
          class="z-tool-tip"
        >
          <Surface
            class="flex items-center justify-center p-1.5 text-ink-muted text-xs wrap-break-word"
            depth={3}
          >
            {content()}
          </Surface>
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
}
