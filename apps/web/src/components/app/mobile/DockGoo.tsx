import { cn } from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  on,
} from 'solid-js';

type Box = { left: number; top: number; width: number; height: number };

/** How far the Search blob reaches toward the dock while pressed, in px. */
const REACH_PX = 14;

/**
 * Liquid glass between the navigation island and Search: while Search is held,
 * a blob behind each island is drawn through a "goo" filter (blur, then a
 * sharp alpha threshold), and the Search blob reaches toward the dock, so the
 * two run together like one drop of glass, as iOS's tab bar does. The blobs
 * sit under the islands and only their bridge shows; at rest the layer is
 * transparent.
 */
export function DockGoo(props: {
  nav: HTMLElement | undefined;
  search: HTMLElement | undefined;
  merging: boolean;
}) {
  const filterId = `dock-goo-${createUniqueId()}`;
  const [boxes, setBoxes] = createSignal<{ nav: Box; search: Box }>();
  const box = (element: HTMLElement): Box => ({
    left: element.offsetLeft,
    top: element.offsetTop,
    width: element.offsetWidth,
    height: element.offsetHeight,
  });
  // Measure where the islands sit as a press starts; nothing moves meanwhile.
  createEffect(
    on(
      () => props.merging,
      (merging) => {
        if (!merging || !props.nav || !props.search) return;
        setBoxes({ nav: box(props.nav), search: box(props.search) });
      }
    )
  );
  const blob = (at: Box | undefined, style: JSX.CSSProperties) =>
    at && {
      left: `${at.left}px`,
      top: `${at.top}px`,
      width: `${at.width}px`,
      height: `${at.height}px`,
      ...style,
    };

  return (
    <>
      <svg aria-hidden="true" class="absolute size-0">
        <filter id={filterId}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </svg>
      <div
        aria-hidden="true"
        data-dock-goo
        data-merging={props.merging ? '' : undefined}
        class={cn(
          'pointer-events-none absolute inset-0 transition-opacity duration-200 ease-out motion-reduce:hidden',
          props.merging ? 'opacity-100' : 'opacity-0'
        )}
        style={{ filter: `url(#${filterId})` }}
      >
        <div
          class="absolute rounded-full bg-chrome"
          style={blob(boxes()?.nav, {})}
        />
        <div
          class="absolute rounded-full bg-chrome transition-[translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={blob(boxes()?.search, {
            translate: props.merging ? `-${REACH_PX}px 0` : '0 0',
          })}
        />
      </div>
    </>
  );
}
