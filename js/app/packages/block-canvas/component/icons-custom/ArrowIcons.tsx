import type { Component, JSX } from 'solid-js';

export const ArrowLine: Component<JSX.SvgSVGAttributes<SVGSVGElement>> = (
  props
) => {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" {...props}>
      <line
        x1="4"
        y1="32"
        x2="60"
        y2="32"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};

export const ArrowCaret: Component<JSX.SvgSVGAttributes<SVGSVGElement>> = (
  props
) => {
  // Arrowhead arms at 45 degrees, length ≈ 9.9 units from (4,32)
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" {...props}>
      <line
        x1="4"
        y1="32"
        x2="13.9"
        y2="22.1"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line
        x1="4"
        y1="32"
        x2="13.9"
        y2="41.9"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line
        x1="4"
        y1="32"
        x2="60"
        y2="32"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};

export const ArrowTriangle: Component<JSX.SvgSVGAttributes<SVGSVGElement>> = (
  props
) => {
  // Triangle: (4,32), (13.9,22.1), (13.9,41.9)
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" {...props}>
      <polygon
        points="4,32 13.9,22.1 13.9,41.9"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line
        x1="9.8"
        y1="32"
        x2="60"
        y2="32"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};

export const ArrowCircle: Component<JSX.SvgSVGAttributes<SVGSVGElement>> = (
  props
) => {
  // Filled circle at (14,32), r=10
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" {...props}>
      <circle
        cx="14"
        cy="32"
        r="10"
        stroke="currentColor"
        fill="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line
        x1="24"
        y1="32"
        x2="60"
        y2="32"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};

export const ArrowCircleSmall: Component<
  JSX.SvgSVGAttributes<SVGSVGElement>
> = (props) => {
  // Filled smaller dot at (14,32), r=7
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" {...props}>
      <circle
        cx="14"
        cy="32"
        r="7"
        stroke="currentColor"
        fill="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line
        x1="21"
        y1="32"
        x2="60"
        y2="32"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};
export const ConnectorStraight: Component<
  JSX.SvgSVGAttributes<SVGSVGElement>
> = (props) => {
  return (
    <svg viewBox="0 0 256 256" {...props}>
      <path
        d="M24 232L232 24"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
    </svg>
  );
};

export const ConnectorStraightArrows: Component<
  JSX.SvgSVGAttributes<SVGSVGElement>
> = (props) => {
  return (
    <svg viewBox="0 0 256 256" {...props}>
      <path
        d="M188 24L232 24L232 68"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
      <path
        d="M68 232L24 232L24 188"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
      <path
        d="M24 232L232 24"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
    </svg>
  );
};

export const ConnectorBezier: Component<JSX.SvgSVGAttributes<SVGSVGElement>> = (
  props
) => {
  return (
    <svg viewBox="0 0 256 256" {...props}>
      <path
        d="M8 186C180 186 52 38 224 38"
        stroke="currentcolor"
        stroke-linecap="round"
        stroke-width="16"
        fill="none"
      />
    </svg>
  );
};

export const ConnectorBezierArrows: Component<
  JSX.SvgSVGAttributes<SVGSVGElement>
> = (props) => {
  return (
    <svg viewBox="0 0 256 256" {...props}>
      <path
        d="M193.444 8L224.556 39.1127L193.444 70.2254"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
      <path
        d="M38.5563 216L8 185.113L38 154"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
      <path
        d="M8 186C180 186 52 38 224 38"
        stroke="currentcolor"
        stroke-linecap="round"
        stroke-width="16"
        fill="none"
      />
    </svg>
  );
};

export const ConnectorStepped: Component<
  JSX.SvgSVGAttributes<SVGSVGElement>
> = (props) => {
  return (
    <svg viewBox="0 0 256 256" {...props}>
      <path
        d="M9 186H116V38H222"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linejoin="round"
        fill="none"
      />
    </svg>
  );
};

export const ConnectorSteppedArrows: Component<
  JSX.SvgSVGAttributes<SVGSVGElement>
> = (props) => {
  return (
    <svg viewBox="0 0 256 256" {...props}>
      <path
        d="M193.444 8L224.556 38L193.444 70.2254"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
      <path
        d="M38.5563 216L8 185.113L38 154"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
      <path
        d="M9 186H116V38H222"
        stroke="currentcolor"
        stroke-width="16"
        stroke-linejoin="round"
        fill="none"
      />
    </svg>
  );
};
