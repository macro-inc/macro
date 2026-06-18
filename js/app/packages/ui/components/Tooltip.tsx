import type { HotkeyToken } from '@core/hotkey/tokens';
import type { Placement } from '@floating-ui/dom';
import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { Surface } from '@ui';
import type { ParentProps } from 'solid-js';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { Hotkey } from '../../ui/components/Hotkey';
import { cn } from '../utils/classname';

type TooltipProps = ParentProps<{
  hotkey?: HotkeyToken | HotkeyToken[];
  /**
   * Raw keyboard shortcut(s) to render in the tooltip (e.g. "cmd+enter").
   * Use this for shortcuts that aren't registered as a `HotkeyToken`.
   */
  shortcut?: string | string[];
  placement?: Placement;
  as?: 'div' | 'span';
  class?: string;
  label: string;
}>;

/**
 * @example
 * <Tooltip label="" hotkey={}>
 *   <div></div>
 * </Tooltip>
 */
export function Tooltip(props: TooltipProps) {
  const [triggerRef, setTriggerRef] = createSignal<HTMLElement>();
  const [open, setOpen] = createSignal(false);

  function tokens(): HotkeyToken[] {
    return props.hotkey == null
      ? []
      : Array.isArray(props.hotkey)
        ? props.hotkey
        : [props.hotkey];
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

  function triggerIsMounted(ref: HTMLElement | undefined): boolean {
    if (!ref) return false;
    if (!ref.ownerDocument.body.contains(ref)) return false;
    if (ref.getClientRects().length > 0) return true;
    return false;
  }

  createEffect(
    on([open, triggerRef], ([open, triggerRef]) => {
      if (!open || !triggerRef) return;

      const closeIfTriggerUnmounted = () => {
        if (triggerIsMounted(triggerRef)) return;
        setOpen(false);
      };

      if (!triggerIsMounted(triggerRef)) {
        setOpen(false);
        return;
      }

      const observer = new MutationObserver(closeIfTriggerUnmounted);
      observer.observe(triggerRef.ownerDocument.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'hidden', 'style'],
        childList: true,
        subtree: true,
      });

      onCleanup(() => {
        observer.disconnect();
      });
    })
  );

  onCleanup(() => setOpen(false));

  return (
    <KobalteTooltip
      open={open()}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
      }}
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
        ref={(ref) => {
          setTriggerRef(ref);
        }}
        class={cn('inline-flex items-center', props.class)}
        as={props.as ?? 'div'}
      >
        {props.children}
      </KobalteTooltip.Trigger>
      <Show when={open()}>
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
                          <Hotkey token={token} theme="subtle" />
                          <Show when={ndx() < tokens().length - 1}>
                            <span class="text-ink-extra-muted">then</span>
                          </Show>
                        </>
                      )}
                    </For>
                    <For each={shortcuts()}>
                      {(shortcut, ndx) => (
                        <>
                          <Hotkey shortcut={shortcut} theme="subtle" />
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
      </Show>
    </KobalteTooltip>
  );
}
