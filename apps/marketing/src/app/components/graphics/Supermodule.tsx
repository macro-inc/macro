import { createUniqueId, For, onCleanup, onMount } from 'solid-js';
import { MACRO_MARK_PATHS } from './MacroMarkIcon';
import { createOrthoPerspectiveTransform } from './orthoPerspective';

const BOB_KEYFRAMES: Keyframe[] = [
  { transform: 'translateY(4px)', easing: 'ease-in-out' },
  { transform: 'translateY(-4px)', offset: 0.5, easing: 'ease-in-out' },
  { transform: 'translateY(4px)' },
];

const FRONT_CAP_MACRO_TRANSFORM = createOrthoPerspectiveTransform({
  scale: 0.42,
  translateX: 428.5,
  translateY: 408.4,
});

/**
 * The larger hero module, ported from the `Supermodule` layer in the Blender
 * export. It is an embeddable SVG group, deliberately like {@link Module}:
 * position it with `place`, give it an optional link, and it quietly animates
 * on its own when motion is allowed.
 */
export function Supermodule(props: {
  place?: string;
  animate?: boolean;
  href?: string;
  ariaLabel?: string;
  onActivate?: (event: MouseEvent) => void;
}) {
  let root: SVGGElement | undefined;
  const capGlowGradientId = createUniqueId();
  const animations: Animation[] = [];

  onCleanup(() => {
    for (const animation of animations) animation.cancel();
  });

  onMount(() => {
    if (
      !root ||
      props.animate === false ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    animations.push(
      root.animate(BOB_KEYFRAMES, {
        duration: 5200,
        iterations: Number.POSITIVE_INFINITY,
      })
    );
  });

  const activate = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    if (event instanceof MouseEvent) props.onActivate?.(event);
    if (props.href && !event.defaultPrevented)
      window.location.href = props.href;
  };

  return (
    <g
      ref={root}
      class={props.href ? 'supermodule-link' : undefined}
      role={props.href ? 'link' : undefined}
      tabindex={props.href ? 0 : undefined}
      aria-label={props.href ? props.ariaLabel : undefined}
      onClick={activate}
      onKeyDown={(event) => {
        if (!props.href || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        activate(event);
      }}
    >
      <g class="supermodule" transform={props.place}>
        <defs>
          <radialGradient id={capGlowGradientId}>
            <stop
              offset="0%"
              stop-color="var(--color-accent)"
              stop-opacity="0.58"
            />
            <stop
              offset="72%"
              stop-color="var(--color-accent)"
              stop-opacity="0.2"
            />
            <stop
              offset="100%"
              stop-color="var(--color-accent)"
              stop-opacity="0"
            />
          </radialGradient>
        </defs>
        <g class="supermodule-back-cap">
          <path d="M328.9,166.8c-18.8-8.8-43-10-66.6-.5-36.1,14.5-65.4,53.5-65.4,87.5,0,13.1,3.9,28.2,12.4,44" />
          <path d="M356.4,211c0,39.7-34.3,85.5-76.5,102.4-42.2,16.9-76.5-1.5-76.5-41.3s34.3-85.5,76.5-102.4c42.2-16.9,76.5,1.5,76.5,41.3Z" />
          <path d="M345.3,226.4c0,30.5-26.3,65.7-58.8,78.7-32.4,13-58.8-1.2-58.8-31.7s26.3-65.7,58.8-78.7c32.4-13,58.8,1.2,58.8,31.7Z" />
        </g>
        <g
          class="supermodule-cap-glows supermodule-cap-glows-back"
          aria-hidden="true"
        >
          <circle
            class="supermodule-cap-glow"
            cx="306"
            cy="265"
            r="96"
            fill={`url(#${capGlowGradientId})`}
          />
        </g>
        <g class="supermodule-cylinder">
          <g class="supermodule-mid-chunk">
            <path d="M352.8,442.9l-116-109.9h0c-9.8-8.6-15.4-21.9-15.4-38.6,0-41.9,36.1-90,80.5-107.8,26.3-10.5,49.6-8.1,64.3,4.4l121.3,115" />
            <path d="M396.5,455.6l-17.8-.4c-23.8-3.6-39.8-21.6-39.8-49.4,0-41.9,36.1-90,80.5-107.8,38.3-15.4,70.3-3.1,78.5,27.3l1.9,20.6" />
            <path d="M500.2,353c0,37.4-32.3,80.6-72.2,96.6-39.8,16-72.2-1.5-72.2-39s32.3-80.6,72.2-96.6c39.8-16,72.2,1.5,72.2,39Z" />
          </g>
        </g>
        <g
          class="supermodule-cap-glows supermodule-cap-glows-front"
          aria-hidden="true"
        >
          <circle
            class="supermodule-cap-glow"
            cx="440"
            cy="394"
            r="96"
            fill={`url(#${capGlowGradientId})`}
          />
        </g>
        <g class="supermodule-rails">
          <g>
            <path d="M252.5,347.9l-12.9-12.2-12.3,16.5-.4,1.6v8.9l3.7,3.5,9.1,4.9,12.7-23.2Z" />
            <path d="M347.8,438.2l-95.3-90.3-12.3,16.5-.4,1.6v8.9l86.2,81.8,9,4.9,12.7-23.3Z" />
            <path d="M373.4,454l-6.3-2.3-5.2-3.9-4-.7-3.5-2.6-6.6-6.3h0s-12.3,16.5-12.3,16.5l-.4,1.6v8.9l3.7,3.5,11.5,6.2,9.1-2.2,14-18.7Z" />
          </g>
          <g>
            <path d="M267.4,231.2l-.8-3.6-5.4-5.1-13.2-7.1-9.1,2.2-11.5,15.4-.4,1.6v8.9l3.7,3.5,9.1,4.9,27.6-20.8Z" />
            <path d="M335.1,342.4l-9-4.9-86.2-81.8v-8.9l.4-1.6,11.5-15.4,9.1-2.2,13.2,7.1,86.2,81.8-.3,3.5-24.9,22.3Z" />
            <path d="M352,356.8l-13.2-7.1-3.7-3.5v-8.9l.4-1.6,11.5-15.4,9.1-2.2,13.2,7.1,3.7,3.5-.6,7,.9,3.9-6.3,7.4-5.2,8h-4c0,.1-5.9,1.8-5.9,1.8" />
          </g>
          <g>
            <path d="M365.9,196.1l-.6-.2-9.6-6.1-3.7-3.5.3-1.5,13.2-17.7,9.1-2.2,11.5,6.2,3.7,3.5v3.7l-24.1,17.8Z" />
            <path d="M485.3,268.7v-3.7l-86.2-81.8-11.5-6.2-9.1,2.2-12.7,17.1-.9,2.2,86.2,81.8,7.7,2.2,3.4,2.6,23.1-16.4Z" />
            <path d="M485.3,268.7l9,4.9,3.7,3.5v8.9l-.4,1.6-14,18.7-5.2-3.9-6.3-2.3-1.8-3.6-6.5-4.1-3.7-3.5.9-2.2,12.7-17.1,9.1-2.2,2.5,1.3" />
          </g>
          <g class="supermodule-inner-lines">
            <path d="M323.4,326.1l-81.1-76.8" />
            <path d="M336.6,314.6l-9.3,12.4" />
            <path d="M253.8,233.8l81.3,77.1" />
            <path d="M358.3,333.5l-9.1,12.2" />
            <path d="M488.1,282.4l8,4.3" />
            <path d="M475.6,295.5l9-12" />
            <path d="M322.9,444.6l-77.5-73.5" />
            <path d="M339.2,430.1l-10.9,14.6" />
            <path d="M464.3,262.6l-9.5,12.7" />
            <path d="M362.3,333.5l11.1,6" />
            <path d="M361.9,354.9l-11.3-6.1" />
            <path d="M350.3,463.3l11.6-15.6" />
            <path d="M359.4,472.7l-8.8-4.8" />
            <path d="M469.7,254.9l-73.7-69.9" />
            <path d="M476.7,260.4l-3-1.6" />
          </g>
        </g>
        <g class="supermodule-front-cap">
          <path d="M376.3,394.8c7.1-26.4,30.2-52.9,57.5-63.8,1.9-.8,3.9-1.5,5.8-2.1" />
          <path d="M528.3,383.9l-1.6-11.9-1-6.2-1.7-5.8-7.8-17.6-.3-.4c-11.6-21.2-38.9-28.4-70.6-15.7-42.3,17-76.6,62.7-76.6,102.5s10.9,38.1,28,44.5q17.6,6.6,36.3,8.5" />
          <path d="M528.7,389.6c0,33.7-29.1,72.7-65,87.1-35.9,14.4-65-1.3-65-35.1s29.1-72.7,65-87.1c35.9-14.4,65,1.3,65,35.1Z" />
          <g
            class="supermodule-macro-logo"
            transform={FRONT_CAP_MACRO_TRANSFORM}
          >
            <For each={MACRO_MARK_PATHS}>{(path) => <path d={path} />}</For>
          </g>
        </g>
      </g>
    </g>
  );
}
