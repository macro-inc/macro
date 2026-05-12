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

export type TooltipProps = ParentProps<{
  onOpenChange?: (open: boolean) => void;
  hotkeySequence?: HotkeySequenceStep[];
  ref?: (el: HTMLElement) => void;
  hotkeyToken?: HotkeyToken;
  placement?: Placement;
  as?: 'div' | 'span';
  shortcut?: string;
  open?: boolean;
  class?: string;
  label: string;
}>;

const DEFAULT_PLACEMENT: Placement = 'bottom';
const TOOLTIP_OVERFLOW_PADDING = 16;
const TOOLTIP_VIEWPORT_PADDING = 16;
const TOOLTIP_FIT_VIEWPORT = true;
const TOOLTIP_GUTTER = 4;
const TOOLTIP_DELAY = 250;
const TOOLTIP_FLIP = true;

/**
 * @example
 * <Tooltip label="Close"><Button>X</Button></Tooltip>
 *
 * <Tooltip label="Zoom" hotkeyToken={TOKENS.canvas.zoomInTool}>
 *   <Button>Zoom</Button>
 * </Tooltip>
 */
export function Tooltip(props: TooltipProps) {
  const steps = (): HotkeySequenceStep[] => {
    if (props.hotkeySequence?.length) { return props.hotkeySequence; }
    if (props.hotkeyToken || props.shortcut) { return [{ token: props.hotkeyToken, shortcut: props.shortcut }]; }
    return [];
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
          </Surface>
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
}
