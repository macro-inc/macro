import type { Component, JSX } from 'solid-js';

export const LineWeight: Component<JSX.SvgSVGAttributes<SVGSVGElement>> = (
  props
) => {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" {...props}>
      <rect x="8" y="8" width="48" height="4" rx="2" stroke="none" />
      <rect x="8" y="20" width="48" height="8" rx="2" stroke="none" />
      <rect x="8" y="36" width="48" height="16" rx="2" stroke="none" />
    </svg>
  );
};
