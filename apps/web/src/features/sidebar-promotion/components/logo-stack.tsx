import { cn } from '@ui';
import type { Component, JSX } from 'solid-js';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export type PromotionLogo = {
  name: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

/** Logos as overlapping round pills, first logo on top. */
export function LogoStack(props: {
  logos: readonly PromotionLogo[];
  class?: string;
}) {
  return (
    <ul
      class={cn('isolate flex items-center -space-x-1.5', props.class)}
      aria-label={props.logos.map((logo) => logo.name).join(', ')}
    >
      <For each={props.logos}>
        {(logo, index) => (
          <li
            class="flex size-6 shrink-0 items-center justify-center rounded-full border border-edge-muted bg-surface ring-2 ring-(--logo-stack-separator,var(--color-control))"
            style={{ 'z-index': props.logos.length - index() }}
            title={logo.name}
          >
            <Dynamic
              component={logo.icon}
              class="size-3.5 text-ink"
              aria-hidden="true"
            />
          </li>
        )}
      </For>
    </ul>
  );
}
