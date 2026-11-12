import RoxMarkIcon from '../../../assets/app-icons/macro-logo.svg';
import type { JSX } from 'solid-js';

export function MacroMarkIcon(props: {
  style?: JSX.CSSProperties;
  class?: string;
}) {
  return (
    <RoxMarkIcon
      aria-hidden="true"
      class={props.class}
      style={props.style}
    />
  );
}
