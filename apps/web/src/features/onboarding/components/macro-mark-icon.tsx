import MacroMarkIcon from '@icon/macro-logo.svg';
import type { JSX } from 'solid-js';

export function MacroMarkIcon(props: {
  style?: JSX.CSSProperties;
  class?: string;
}) {
  return (
    <MacroMarkIcon
      aria-hidden="true"
      class={props.class}
      style={props.style}
    />
  );
}
