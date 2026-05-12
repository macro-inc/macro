import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Hotkey } from '../../ui/components/Hotkey';
import type { Placement } from '@floating-ui/dom';
import type { ParentProps } from 'solid-js';
import { For, Show } from 'solid-js';
import { Surface } from '@ui';

export type HotkeySequenceStep = {
  token?: HotkeyToken;
};

export type TooltipProps = ParentProps<{
  hotkeySequence?: HotkeySequenceStep[];
  hotkeyToken?: HotkeyToken;
  placement?: Placement;
  as?: 'div' | 'span';
  label: string;
}>;

/**
 * @example
 * <Tooltip label="Zoom" hotkeyToken={TOKENS.canvas.zoomInTool}>
 *   <Button>Zoom</Button>
 * </Tooltip>
 */
export function Tooltip(props: TooltipProps) {
  const steps = (): HotkeySequenceStep[] => {
    if (props.hotkeySequence?.length) { return props.hotkeySequence; }
    if (props.hotkeyToken) { return [{ token: props.hotkeyToken }]; }
    return [];
  };

  return (
    <KobalteTooltip
      placement={props.placement ?? 'bottom'}
      overflowPadding={16}
      fitViewport={true}
      closeDelay={250}
      openDelay={250}
      flip={true}
      gutter={4}
    >
      <KobalteTooltip.Trigger
        class="inline-flex items-center"
        as={props.as ?? 'div'}
      >
        {props.children}
      </KobalteTooltip.Trigger>
      <KobalteTooltip.Portal>
        <KobalteTooltip.Content class="z-tool-tip max-w-[calc(100vw-32px)]">
          <Surface
            class="flex items-center justify-center p-2 text-ink-muted text-xs wrap-break-word"
            depth={3}
          >
            <div class="flex flex-row items-center gap-2">
              <div class="text-xs capitalize">{props.label}</div>
              <Show when={steps().length > 0}>
                <div class="flex items-center gap-1 ml-auto">
                  <For each={steps()}>
                    {(step, ndx) => (
                      <>
                        <Hotkey
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
