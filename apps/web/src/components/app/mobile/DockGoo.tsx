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
 * two run together like one drop of glass, as iOS's tab bar does (rida.dev
 * draws the same smooth-min union in a shader). The islands are translucent,
 * so the layer is masked to their outside and only the bulge between them
 * shows, in the glass's solid tone; at rest the layer is transparent.
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
  // Everything but the islands themselves: the drop shows only where it
  // bulges out of them. The islands are pills (fully rounded), so each hole
  // is a stadium cut from the layer with the even-odd rule.
  const [layer, setLayer] = createSignal<HTMLDivElement>();
  const outsideIslands = () => {
    const at = boxes();
    const element = layer();
    if (!at || !element) return undefined;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const pill = ({ left, top, width: w, height: h }: Box) => {
      const r = Math.min(w, h) / 2;
      return `M${left + r} ${top}H${left + w - r}A${r} ${r} 0 0 1 ${left + w - r} ${top + h}H${left + r}A${r} ${r} 0 0 1 ${left + r} ${top}Z`;
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill-rule="evenodd" d="M0 0H${width}V${height}H0Z${pill(at.nav)}${pill(at.search)}"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0 / ${width}px ${height}px no-repeat`;
  };
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
        <filter id={filterId} color-interpolation-filters="sRGB">
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
        ref={setLayer}
        style={{ filter: `url(#${filterId})`, mask: outsideIslands() }}
      >
        <div
          class="absolute rounded-full bg-glass-solid"
          style={blob(boxes()?.nav, {})}
        />
        <div
          class="absolute rounded-full bg-glass-solid transition-[translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={blob(boxes()?.search, {
            translate: props.merging ? `-${REACH_PX}px 0` : '0 0',
          })}
        />
      </div>
    </>
  );
}
