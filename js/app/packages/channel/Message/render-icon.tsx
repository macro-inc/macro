import type { Component, JSX } from 'solid-js';
import { cn } from '@ui';

export function renderIcon(
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>> | string,
  className?: string
): JSX.Element {
  if (typeof icon === 'string') {
    return <img src={icon} alt="" class={cn('size-4', className)} />;
  }

  const Icon = icon;
  return <Icon class={cn('size-4', className)} />;
}
