import {
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
} from 'solid-js';

// Renders a faux-app hero mock at a fixed "design" width and scales it down to
// fit narrow (phone) viewports, so dense product mockups stay fully visible and
// proportional instead of being clipped by the hero column's overflow.
//
// When `active` is false (tablet/desktop) the children render at their normal
// width with no transform, preserving the existing layout exactly.
export function HeroScaleToFit(props: {
  active: boolean;
  designWidth: number;
  children: JSX.Element;
}) {
  let outer: HTMLDivElement | undefined;
  let inner: HTMLDivElement | undefined;
  const [scale, setScale] = createSignal(1);
  const [height, setHeight] = createSignal<number | undefined>(undefined);

  const update = () => {
    if (!outer || !inner || !props.active) {
      setScale(1);
      setHeight(undefined);
      return;
    }
    const available = outer.clientWidth;
    const next = Math.min(1, available / props.designWidth);
    setScale(next);
    setHeight(inner.offsetHeight * next);
  };

  onMount(() => {
    update();
    const ro = new ResizeObserver(update);
    if (outer) ro.observe(outer);
    if (inner) ro.observe(inner);
    window.addEventListener('resize', update);
    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    });
  });

  // Recompute when the active flag flips across the breakpoint.
  createEffect(() => {
    props.active;
    update();
  });

  return (
    <div
      ref={outer}
      style={{
        width: '100%',
        'min-width': '0',
        'max-width': '100%',
        height: props.active && height() != null ? `${height()}px` : undefined,
        overflow: 'hidden',
      }}
    >
      {/* Clip wrapper sized to the scaled footprint so the fixed-width inner
          mock does not expand grid tracks beyond the available column width. */}
      <div
        style={{
          overflow: 'hidden',
          width: props.active ? `${props.designWidth * scale()}px` : '100%',
        }}
      >
        <div
          ref={inner}
          style={{
            width: props.active ? `${props.designWidth}px` : '100%',
            transform: props.active ? `scale(${scale()})` : undefined,
            'transform-origin': 'top left',
          }}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
