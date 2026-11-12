import type { JSX } from 'solid-js';
import RoxMarkIcon from '../../../assets/app-icons/macro-logo.svg';

export function MacroMarkIcon(props: {
  style?: JSX.CSSProperties;
  class?: string;
}) {
  return (
    <RoxMarkIcon aria-hidden="true" class={props.class} style={props.style} />
  );
}
