import { type JSX, Show } from 'solid-js';
import './demo-cursor.css';

// A conventional mouse arrow, with its hotspot at the top-left tip.
const POINTER_PATH = 'M1 1v18l4.4-4.4 3.8 8.4 3.8-1.8L9.1 13h7.7Z';

/**
 * Operating mouse, distinct from a collaborator's text caret.
 * Names are optional and identify the actor only when useful.
 * Callers position it with `class` or `style`; the tip sits at (0, 0).
 */
export function DemoCursor(props: {
  label?: string;
  class?: string;
  style?: JSX.CSSProperties;
  clicking?: boolean;
  caret?: boolean;
  ref?: (element: HTMLDivElement) => void;
}) {
  return (
    <div
      ref={props.ref}
      class={`demo-cursor${props.class ? ` ${props.class}` : ''}`}
      style={props.style}
      data-clicking={props.clicking ? 'true' : undefined}
      data-caret={props.caret ? 'true' : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 26">
        <path d={POINTER_PATH} />
      </svg>
      <Show when={props.label}>
        <span>{props.label}</span>
      </Show>
    </div>
  );
}
