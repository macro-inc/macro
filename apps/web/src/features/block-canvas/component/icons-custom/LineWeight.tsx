import type { Component, JSX } from 'solid-js';

export const LineWeight: Component<JSX.SvgSVGAttributes<SVGSVGElement>> = (
  props
) => {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" {...props}>
      {/* `fill="currentColor"`, like every other icon in this folder: callers
          colour icon slots with `text-*`, not `fill-*` (a fill utility would
          also override the `fill="none"` on Lucide and connector art). */}
      <rect
        x="8"
        y="8"
        width="48"
        height="4"
        rx="2"
        stroke="none"
        fill="currentColor"
      />
      <rect
        x="8"
        y="20"
        width="48"
        height="8"
        rx="2"
        stroke="none"
        fill="currentColor"
      />
      <rect
        x="8"
        y="36"
        width="48"
        height="16"
        rx="2"
        stroke="none"
        fill="currentColor"
      />
    </svg>
  );
};
