import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from '@floating-ui/dom';
import { cn } from '@ui';
import { type JSX, onCleanup, onMount } from 'solid-js';

type HoverActionsProps = {
  class?: string;
  children: JSX.Element;
  persistentVisible?: boolean;
  /**
   * 'straddle' (default) centers the toolbar on the row's top edge — fine
   * for header rows, whose right side is empty. 'above' places it fully
   * above the row so it never covers the row's own content — needed for
   * grouped rows, where text starts at the very top.
   */
  position?: 'straddle' | 'above';
};

export function HoverActions(props: HoverActionsProps) {
  let toolbar!: HTMLDivElement;

  onMount(() => {
    const row = toolbar.closest<HTMLElement>('[data-message]');
    const viewport = toolbar.closest<HTMLElement>('[data-channel-scroll]');
    if (!row || !viewport) return;

    let revision = 0;
    const updatePosition = async () => {
      const current = ++revision;
      const position = await computePosition(row, toolbar, {
        placement: 'top-end',
        middleware: [
          offset(() =>
            props.position === 'above' ? 0 : -toolbar.offsetHeight / 2
          ),
          flip({ boundary: viewport, padding: 8 }),
          shift({ boundary: viewport, padding: 8, crossAxis: true }),
          size({
            boundary: viewport,
            padding: 8,
            apply({ availableWidth, elements }) {
              if (current !== revision) return;
              elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
            },
          }),
        ],
      });
      if (current !== revision) return;
      Object.assign(toolbar.style, {
        left: `${position.x}px`,
        top: `${position.y}px`,
        right: 'auto',
        bottom: 'auto',
        translate: 'none',
      });
    };
    const cleanup = autoUpdate(row, toolbar, () => {
      fireAndForget(updatePosition(), 'message-hover-actions');
    });
    onCleanup(() => {
      revision++;
      cleanup();
    });
  });
  return (
    <div
      ref={toolbar}
      class={cn(
        'absolute right-4 z-10 w-max max-w-full',
        props.position === 'above' ? 'bottom-full' : 'top-0 -translate-y-1/2',
        props.persistentVisible
          ? ''
          : 'hidden group-hover/message:block group-focus-within/message:block',
        isTouchDevice() && 'hidden',
        props.class
      )}
      data-message-hover-actions
    >
      {props.children}
    </div>
  );
}
