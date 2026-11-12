import MacroMarkSvg from '@icon/macro-logo.svg';
import type { JSX } from 'solid-js';

export function MacroMarkIcon(props: {
  style?: JSX.CSSProperties;
  class?: string;
}) {
  return (
    <MacroMarkSvg aria-hidden="true" class={props.class} style={props.style} />
  );
}
