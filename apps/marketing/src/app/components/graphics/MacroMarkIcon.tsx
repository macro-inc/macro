import type { JSX } from 'solid-js';

export const MACRO_MARK_PATHS = [
  'M0.121368 44.5707V94.6784L0.123097 94.8165C0.140592 95.5053 0.289921 96.1847 0.563153 96.8184C0.854625 97.4943 1.28114 98.1038 1.8166 98.6094L22.5065 118.144L37.6081 112.239V59.7876L15.2084 38.6654L0.121368 44.5707Z',
  'M30.89 6.04832V48.797L41.1458 58.4696V68.173L94.2982 118.349L109.4 112.444L109.392 59.9907L45.9767 0.140625L30.89 6.04832Z',
  'M102.685 6.04936V48.7977L112.948 58.4841L112.848 68.0867L166.111 118.35L181.197 112.445V62.3371C181.198 61.6013 181.047 60.8733 180.756 60.1975C180.465 59.5216 180.038 58.9121 179.503 58.4065L117.789 0.140625L102.685 6.04936Z',
] as const;

// The three strokes of the Macro mark — left, center, and right — split apart
// horizontally when the header logo link is hovered.
export function MacroMarkIcon(props: {
  style?: JSX.CSSProperties;
  class?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 182 119"
      fill="currentColor"
      aria-hidden="true"
      class={props.class}
      style={props.style}
    >
      <style>{`
        .macro-mark-part {
          transform-box: fill-box;
          transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .macro-mark-left { transform-origin: 85% 50%; }
        .macro-mark-mid { transform-origin: center; }
        .macro-mark-right { transform-origin: 15% 50%; }
        @media (hover) {
          .base-header-logo:hover .macro-mark-left {
            transform: translateX(-11px) scale(1.06);
          }
          .base-header-logo:hover .macro-mark-mid {
            transform: scale(1.1);
          }
          .base-header-logo:hover .macro-mark-right {
            transform: translateX(11px) scale(1.06);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .macro-mark-part { transition: none; }
        }
      `}</style>
      <g class="macro-mark-part macro-mark-left">
        <path d={MACRO_MARK_PATHS[0]} />
      </g>
      <g class="macro-mark-part macro-mark-mid">
        <path d={MACRO_MARK_PATHS[1]} />
      </g>
      <g class="macro-mark-part macro-mark-right">
        <path d={MACRO_MARK_PATHS[2]} />
      </g>
    </svg>
  );
}
