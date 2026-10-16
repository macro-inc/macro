import { cn } from '@ui';
import type { Component, JSX } from 'solid-js';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export type PromotionLogo = {
  name: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

const SIZES = {
  sm: { pill: 'size-6', icon: 'size-3.5', overlap: '-space-x-1.5' },
  md: { pill: 'size-9', icon: 'size-5', overlap: '-space-x-2.5' },
};

/** Logos as overlapping round pills, first logo on top. */
export function LogoStack(props: {
  logos: readonly PromotionLogo[];
  size?: keyof typeof SIZES;
  class?: string;
}) {
  const size = () => SIZES[props.size ?? 'sm'];
  return (
    <ul
      class={cn('isolate flex items-center', size().overlap, props.class)}
      aria-label={props.logos.map((logo) => logo.name).join(', ')}
    >
      <For each={props.logos}>
        {(logo, index) => (
          <li
            class={cn(
              'flex shrink-0 items-center justify-center rounded-full border border-edge-muted bg-surface ring-2 ring-(--logo-stack-separator,var(--color-control))',
              size().pill
            )}
            style={{ 'z-index': props.logos.length - index() }}
            title={logo.name}
          >
            <Dynamic
              component={logo.icon}
              class={cn('text-ink', size().icon)}
              aria-hidden="true"
            />
          </li>
        )}
      </For>
    </ul>
  );
}
