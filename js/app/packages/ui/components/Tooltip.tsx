import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { Hotkey } from '../../ui/components/Hotkey';
import type { Placement } from '@floating-ui/dom';
import type { ParentProps } from 'solid-js';
import { For, Show } from 'solid-js';
import { Surface } from '@ui';

export type TooltipProps = ParentProps<{
  hotkey?: HotkeyToken | HotkeyToken[];
  /**
   * Raw keyboard shortcut(s) to render in the tooltip (e.g. "cmd+enter").
   * Use this for shortcuts that aren't registered as a `HotkeyToken`.
   */
  shortcut?: string | string[];
  placement?: Placement;
  as?: 'div' | 'span';
  label: string;
}>;

/**
 * @example
 * <Tooltip label="" hotkey={}>
 *   <div></div>
 * </Tooltip>
 */
export function Tooltip(props: TooltipProps) {
  function tokens(): HotkeyToken[] {
    return props.hotkey == null ? [] : Array.isArray(props.hotkey) ? props.hotkey : [props.hotkey];
  }

  function shortcuts(): string[] {
    return props.shortcut == null
      ? []
      : Array.isArray(props.shortcut)
        ? props.shortcut
        : [props.shortcut];
  }

  function hasHotkey(): boolean {
    return tokens().length > 0 || shortcuts().length > 0;
  }

  return (
    <KobalteTooltip
      placement={props.placement ?? 'bottom'}
      ignoreSafeArea={true}
      overflowPadding={16}
      fitViewport={true}
      openDelay={400}
      closeDelay={0}
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
              <div class="text-xs">{props.label}</div>
              <Show when={hasHotkey()}>
                <div class="flex items-center gap-1 ml-auto">
                  <For each={tokens()}>
                    {(token, ndx) => (
                      <>
                        <Hotkey
                          token={token}
                          theme="subtle"
                        />
                        <Show when={ndx() < tokens().length - 1}>
                          <span class="text-ink-extra-muted">then</span>
                        </Show>
                      </>
                    )}
                  </For>
                  <For each={shortcuts()}>
                    {(shortcut, ndx) => (
                      <>
                        <Hotkey
                          shortcut={shortcut}
                          theme="subtle"
                        />
                        <Show when={ndx() < shortcuts().length - 1}>
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
