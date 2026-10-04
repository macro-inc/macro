import type { JSX } from 'solid-js';
import './demo-cursor.css';

// Macro's rounded pointer, the same shape the homepage CRM demo uses.
const POINTER_PATH =
  'M3.902 8.546L5.012 5.511L5.512 5.011L8.547 3.902L8.562 3.896C8.7 3.834 8.817 3.733 8.896 3.604C8.976 3.475 9.014 3.326 9.007 3.175C9 3.024 8.947 2.878 8.856 2.758C8.765 2.637 8.639 2.547 8.496 2.499L0.992 0.049C0.861 0.006 0.72 0 0.586 0.032C0.452 0.064 0.329 0.133 0.231 0.231C0.133 0.328 0.065 0.451 0.032 0.585C0 0.72 0.006 0.86 0.049 0.992L2.499 8.496C2.545 8.64 2.635 8.768 2.756 8.86C2.877 8.952 3.023 9.005 3.175 9.011H3.211C3.357 9.012 3.5 8.969 3.621 8.889C3.743 8.809 3.839 8.695 3.896 8.562L3.902 8.546Z';

/**
 * The one animated cursor for every website demo: Macro's pointer with a
 * name tag. Agents are labelled "Claude"; people use their first name.
 * Callers position it with `class` or `style`; the tip sits at (0, 0).
 */
export function DemoCursor(props: {
  label?: string;
  class?: string;
  style?: JSX.CSSProperties;
  clicking?: boolean;
  ref?: (element: HTMLDivElement) => void;
}) {
  return (
    <div
      ref={props.ref}
      class={`demo-cursor${props.class ? ` ${props.class}` : ''}`}
      style={props.style}
      data-clicking={props.clicking ? 'true' : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 9.014 9.012">
        <path d={POINTER_PATH} />
      </svg>
      <span>{props.label ?? 'Claude'}</span>
    </div>
  );
}
