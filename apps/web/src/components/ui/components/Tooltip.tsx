import type { HotkeyToken } from '@core/hotkey/tokens';
import type { Placement } from '@floating-ui/dom';
import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import type { ParentProps } from 'solid-js';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { Hotkey } from '../../ui/components/Hotkey';
import { tooltipsEnabled } from '../signals/signals';
import { cn } from '../utils/classname';
import { Surface } from './Surface';

type TooltipProps = ParentProps<{
  hotkey?: HotkeyToken | HotkeyToken[];
  /**
   * Raw keyboard shortcut(s) to render in the tooltip (e.g. "cmd+enter").
   * Use this for shortcuts that aren't registered as a `HotkeyToken`.
   */
  shortcut?: string | string[];
  placement?: Placement;
  openDelay?: number;
  contentClass?: string;
  as?: 'div' | 'span';
  class?: string;
  label: string;
  /** Allows non-interactive tooltip targets, such as disabled actions, to receive keyboard focus. */
  tabIndex?: number;
  disabled?: boolean;
  /** Override visibility, for example while a nested control has keyboard focus. */
  open?: boolean;
}>;

export type TooltipClassOptions = {
  class?: string;
};

/** Canonical classes for tooltip content and tooltip-like static hints. */
export function tooltipClasses(options: TooltipClassOptions = {}): string {
  return cn(
    'menu-surface flex items-center justify-center rounded-xl p-2 text-xs text-ink-muted wrap-break-word',
    options.class
  );
}

/**
 * @example
 * <Tooltip label="" hotkey={}>
 *   <div></div>
 * </Tooltip>
 */
export function Tooltip(props: TooltipProps) {
  const [triggerRef, setTriggerRef] = createSignal<HTMLElement>();
  const [open, setOpen] = createSignal(false);
  const isOpen = () => props.open ?? open();

  if (import.meta.env.MODE === 'test') {
    return <>{props.children}</>;
  }

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

  // Kobalte shares hover warm-up across tooltips. An explicit delay must apply
  // to each target, even when the pointer moves directly from another tooltip.
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelHover = () => {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
  };
  const closeDelayedHover = () => {
    if (props.openDelay === undefined) return;
    cancelHover();
    setOpen(false);
  };
  onCleanup(() => {
    cancelHover();
    setOpen(false);
  });
  const visible = () => isOpen() && !props.disabled && tooltipsEnabled();

  return (
    <KobalteTooltip
      open={visible()}
      onOpenChange={(isOpen) => {
        setOpen(isOpen && !props.disabled && tooltipsEnabled());
      }}
      placement={props.placement ?? 'bottom'}
      ignoreSafeArea={true}
      overflowPadding={16}
      fitViewport={true}
      openDelay={props.openDelay ?? 400}
      triggerOnFocusOnly={props.openDelay !== undefined}
      closeDelay={0}
      flip={true}
      gutter={4}
      disabled={props.disabled || !tooltipsEnabled()}
    >
      <KobalteTooltip.Trigger
        ref={(ref) => {
          setTriggerRef(ref);
        }}
        class={cn('inline-flex items-center', props.class)}
        onPointerEnter={(event) => {
          if (props.openDelay === undefined || event.pointerType === 'touch')
            return;
          cancelHover();
          hoverTimer = setTimeout(() => {
            hoverTimer = undefined;
            setOpen(!props.disabled && tooltipsEnabled());
          }, props.openDelay);
        }}
        onPointerLeave={closeDelayedHover}
        onPointerDown={closeDelayedHover}
        onBlur={closeDelayedHover}
        tabIndex={props.tabIndex}
        as={props.as ?? 'div'}
      >
        {props.children}
      </KobalteTooltip.Trigger>
      <Show when={visible()}>
        <KobalteTooltip.Portal>
          <KobalteTooltip.Content
            class={cn(
              'z-tool-tip max-w-[calc(100vw-32px)]',
              props.contentClass
            )}
          >
            <Surface class={tooltipClasses()} depth={2} hideBorder>
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
