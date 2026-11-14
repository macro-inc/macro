import {
  type SlideTransitionKind,
  TRANSITION_DEFAULT_DURATION_MS,
  type TransitionDirection,
} from '@macro-inc/graphics';
import { createEffect, For, on, onCleanup, onMount, Show } from 'solid-js';
import {
  type CameraPath,
  cameraTransform,
  fitView,
  flyPath,
  overviewPath,
  panPath,
  routePath,
  sampleViews,
} from '../core/transitions/camera-path';
import { classicKeyframes } from '../core/transitions/classic-keyframes';
import { easingCss, easingFunction } from '../core/transitions/easing';

/** Thumbnails are drawn at this size, in px. */
const WIDTH = 48;
const HEIGHT = 30;
const STAGE = { width: WIDTH, height: HEIGHT };
/** At rest a thumbnail holds this point of its animation, so it reads at a
 * glance without motion. */
const REST_PROGRESS = 0.42;
/** Kinds whose middle frame is empty rest earlier, where both slides show. */
const REST_PROGRESS_BY_KIND: Partial<Record<SlideTransitionKind, number>> = {
  fadeThroughBlack: 0.3,
  flip: 0.3,
  pan: 0.3,
};
const HOLD_MS = 500;

/** A tiny map for canvas kinds: three slides and the arrow between the first
 * two, in thumbnail pixels at zoom 1. */
const MAP_SLIDES = [
  { x: 0, y: 0 },
  { x: 100, y: 34 },
  { x: 24, y: 76 },
] as const;
const MAP_ROUTE = [
  { x: 48, y: 15 },
  { x: 74, y: 15 },
  { x: 74, y: 49 },
  { x: 100, y: 49 },
];

const center = (index: 0 | 1) => ({
  x: MAP_SLIDES[index].x,
  y: MAP_SLIDES[index].y,
  width: WIDTH,
  height: HEIGHT,
});

function mapPath(kind: SlideTransitionKind): CameraPath {
  const from = fitView(center(0), STAGE);
  const to = fitView(center(1), STAGE);
  if (kind === 'pan') return panPath(from, to);
  if (kind === 'path') return routePath(from, to, MAP_ROUTE, STAGE);
  if (kind === 'overview')
    return overviewPath(
      from,
      to,
      fitView({ x: 0, y: 0, width: 148, height: 106 }, STAGE, 0.06),
      STAGE
    );
  return flyPath(from, to, STAGE);
}

/** Two little slides: a quiet one and a bold one with "text" lines. */
function MiniSlide(props: { bold?: boolean }) {
  return (
    <div
      class="flex size-full flex-col justify-center gap-[3px] px-[6px]"
      classList={{
        'bg-ink text-surface': props.bold,
        'bg-hover text-ink-extra-muted': !props.bold,
      }}
    >
      <div class="h-[3px] w-1/2 rounded-full bg-current" />
      <div class="h-[2px] w-3/4 rounded-full bg-current opacity-60" />
    </div>
  );
}

/**
 * A tiny live preview of a transition. At rest it holds a frame partway
 * through; while `playing` it loops the real transition at a slower pace.
 */
export function TransitionThumbnail(props: {
  kind: SlideTransitionKind;
  direction: TransitionDirection;
  playing: boolean;
  /** Each increase plays the animation once, for taps on touch. */
  playCount?: number;
}) {
  let stage!: HTMLDivElement;
  let outgoing: HTMLDivElement | undefined;
  let incoming: HTMLDivElement | undefined;
  let world: HTMLDivElement | undefined;
  let animations: Animation[] = [];
  let playingOnce = false;
  const isMap = () =>
    props.kind === 'pan' ||
    props.kind === 'fly' ||
    props.kind === 'overview' ||
    props.kind === 'path';

  const build = () => {
    for (const animation of animations) animation.cancel();
    animations = [];
    const kind = props.kind;
    const duration = Math.max(600, TRANSITION_DEFAULT_DURATION_MS[kind] * 1.4);
    const timing: KeyframeAnimationOptions = {
      duration,
      easing: easingCss('easeInOut'),
      fill: 'both',
      endDelay: HOLD_MS,
    };

    if (kind === 'none') return;

    if (isMap()) {
      if (!world) return;
      const views = sampleViews(mapPath(kind), easingFunction('easeInOut'), 40);
      animations = [
        world.animate(
          views.map((view) => ({
            transform: cameraTransform(view, { x: 0, y: 0 }, 1, STAGE),
          })),
          { ...timing, easing: 'linear' }
        ),
      ];
    } else if (
      incoming &&
      outgoing &&
      kind !== 'pan' &&
      kind !== 'fly' &&
      kind !== 'overview' &&
      kind !== 'path'
    ) {
      const keyframes = classicKeyframes(kind, props.direction, false, STAGE);
      stage.style.perspective = keyframes.perspective
        ? `${keyframes.perspective}px`
        : '';
      incoming.style.zIndex = keyframes.incomingOnTop ? '2' : '1';
      outgoing.style.zIndex = keyframes.incomingOnTop ? '1' : '2';
      const backface = keyframes.perspective ? 'hidden' : '';
      incoming.style.backfaceVisibility = backface;
      outgoing.style.backfaceVisibility = backface;
      animations = [
        keyframes.incoming.length
          ? incoming.animate(
              keyframes.incoming.map((frame) => ({ ...frame })),
              timing
            )
          : undefined,
        keyframes.outgoing.length
          ? outgoing.animate(
              keyframes.outgoing.map((frame) => ({ ...frame })),
              timing
            )
          : undefined,
      ].filter((animation) => animation !== undefined);
    }

    for (const animation of animations) {
      animation.onfinish = () => {
        if (props.playing) {
          animation.currentTime = 0;
          animation.play();
          return;
        }
        if (playingOnce) {
          playingOnce = false;
          pose();
        }
      };
    }
    pose();
  };

  const pose = () => {
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    for (const animation of animations) {
      const duration = Number(animation.effect?.getTiming().duration ?? 0);
      if ((props.playing || playingOnce) && !reduced) {
        animation.currentTime = 0;
        animation.play();
      } else {
        animation.pause();
        animation.currentTime =
          duration * (REST_PROGRESS_BY_KIND[props.kind] ?? REST_PROGRESS);
      }
    }
  };

  onMount(build);
  createEffect(
    on([() => props.kind, () => props.direction], build, { defer: true })
  );
  createEffect(on(() => props.playing, pose, { defer: true }));
  createEffect(
    on(
      () => props.playCount,
      () => {
        playingOnce = true;
        pose();
      },
      { defer: true }
    )
  );
  onCleanup(() => {
    for (const animation of animations) animation.cancel();
  });

  return (
    <div
      ref={stage}
      aria-hidden="true"
      class="relative shrink-0 overflow-hidden rounded-[3px] bg-panel"
      style={{ width: `${WIDTH}px`, height: `${HEIGHT}px` }}
    >
      <Show
        when={isMap()}
        fallback={
          <Show
            when={props.kind !== 'none'}
            fallback={
              <div class="absolute inset-0 flex">
                <div class="w-1/2 overflow-hidden">
                  <MiniSlide />
                </div>
                <div class="w-px bg-panel" />
                <div class="flex-1 overflow-hidden">
                  <MiniSlide bold />
                </div>
              </div>
            }
          >
            <div ref={outgoing} class="absolute inset-0">
              <MiniSlide />
            </div>
            <div ref={incoming} class="absolute inset-0">
              <MiniSlide bold />
            </div>
          </Show>
        }
      >
        <div ref={world} class="absolute left-0 top-0 origin-top-left">
          <svg
            class="absolute left-0 top-0 overflow-visible text-ink-extra-muted"
            width="150"
            height="110"
            aria-hidden="true"
          >
            <polyline
              points={MAP_ROUTE.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-dasharray={props.kind === 'path' ? undefined : '3 3'}
            />
          </svg>
          <For each={MAP_SLIDES}>
            {(slide, index) => (
              <div
                class="absolute overflow-hidden rounded-[2px]"
                style={{
                  left: `${slide.x}px`,
                  top: `${slide.y}px`,
                  width: `${WIDTH}px`,
                  height: `${HEIGHT}px`,
                }}
              >
                <MiniSlide bold={index() === 1} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
