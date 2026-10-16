import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from '@floating-ui/dom';
import { type JSX, onCleanup, onMount } from 'solid-js';

/**
 * A popup below (or above) a cell or formula editor. Pressing it keeps focus
 * and editing in the editor.
 */
export function EditorPopup(props: {
  anchor: HTMLElement;
  interactive: boolean;
  class?: string;
  children: JSX.Element;
  onReady?: (element: HTMLDivElement) => void;
  onOutsidePress: () => void;
}) {
  let element!: HTMLDivElement;
  onMount(() => {
    props.onReady?.(element);
    // Pressing a cell, sheet tab, or toolbar keeps the draft but closes the popup.
    const press = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!element.contains(target) && !props.anchor.contains(target))
        props.onOutsidePress();
    };
    document.addEventListener('pointerdown', press, true);
    onCleanup(() => document.removeEventListener('pointerdown', press, true));
    let alive = true;
    const update = async () => {
      const position = await computePosition(props.anchor, element, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [
          offset(5),
          flip(),
          shift({ padding: 12 }),
          size({
            padding: 12,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
            },
          }),
        ],
      });
      if (alive)
        Object.assign(element.style, {
          left: `${position.x}px`,
          top: `${position.y}px`,
          visibility: 'visible',
        });
    };
    const cleanup = autoUpdate(props.anchor, element, () => {
      void update();
    });
    onCleanup(() => {
      alive = false;
      cleanup();
    });
  });
  return (
    <div
      ref={element}
      style={{ visibility: 'hidden' }}
      class={`fixed z-[100] flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-edge bg-panel text-ink shadow-xl ${props.class ?? ''}`}
      classList={{ 'pointer-events-none': !props.interactive }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {props.children}
    </div>
  );
}
