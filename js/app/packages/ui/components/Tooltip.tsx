import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Hotkey } from '../../ui/components/Hotkey';
import type { Placement } from '@floating-ui/dom';
import type { ParentProps } from 'solid-js';
import { For, Show } from 'solid-js';
import { cn, Surface } from '@ui';

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

export type TooltipProps = ParentProps<{
  hotkeySequence?: HotkeySequenceStep[];
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  label: string;
  onOpenChange?: (open: boolean) => void;
  ref?: (el: HTMLElement) => void;
  placement?: Placement;
  as?: 'div' | 'span';
  open?: boolean;
  class?: string;
}>;

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
 * Renders a single label row with an optional hotkey badge (driven by
 * `hotkeyToken`, `shortcut`, or `hotkeySequence`).
 *
 * For rich JSX hover content (icons, lists, structured info, selectable
 * text), use `HoverCard`. For click-engaged surfaces, use `Popover`.
 *
 * @example
 * <Tooltip label="Close"><Button>X</Button></Tooltip>
 *
 * <Tooltip label="Zoom" hotkeyToken={TOKENS.canvas.zoomInTool}>
 *   <Button>Zoom</Button>
 * </Tooltip>
 */
export function Tooltip(props: TooltipProps) {
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
            <LabelAndHotKey
              hotkeySequence={props.hotkeySequence}
              hotkeyToken={props.hotkeyToken}
              shortcut={props.shortcut}
              label={props.label}
            />
          </Surface>
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
}
