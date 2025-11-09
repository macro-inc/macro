import Spinner from '@icon/regular/spinner.svg';
import type { Component, JSX } from 'solid-js';

export const CircleSpinner: Component<JSX.SvgSVGAttributes<SVGSVGElement>> = (
  props
) => {
  return (
    <Spinner
      class="animate-spin text-ink-muted"
      width={props.width || 20}
      height={props.height || 20}
    />
  );
};
