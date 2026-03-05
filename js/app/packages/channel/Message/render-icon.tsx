import type { Component, JSX } from 'solid-js';

export function renderIcon(
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>> | string
): JSX.Element {
  if (typeof icon === 'string') {
    return <img src={icon} alt="" class="size-4" />;
  }

  const Icon = icon;
  return <Icon class="size-4" />;
}
