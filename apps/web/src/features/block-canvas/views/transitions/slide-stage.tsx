import { beginInteraction } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type ArtifactItem,
  CANVAS_TRANSITION_KINDS,
  type GraphicsDocument,
  type ResolvedSlideTransition,
  resolveSlideTransition,
  type SlideTransition,
} from '@macro-inc/graphics';
import { ResultAsync } from 'neverthrow';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { cameraTransform } from '../../core/transitions/camera-path';
import {
  type CameraPlan,
  type CanvasKind,
  cameraPlan,
} from '../../core/transitions/camera-plan';
import { classicKeyframes } from '../../core/transitions/classic-keyframes';
import { easingCss, easingFunction } from '../../core/transitions/easing';
import { ArtifactFrame } from '../artifact-frame';
import { CanvasFlight, type FlightLayers } from './canvas-flight';
import {
  animateCamera,
  animateLayers,
  animationsFinished,
  type FrameStats,
  type TransitionOutcome,
  watchFrames,
} from './play-transition';

/** Reduced motion plays every kind as this short fade. */
const REDUCED_MOTION_MS = 200;
/** How long a transition waits for the next slide's document to load. */
const LOAD_WAIT_MS = 400;
/** Eager slides a canvas move mounts, beyond its two endpoints. */
const MAX_EAGER_SLIDES = 12;

const isCanvasKind = (kind: string): kind is CanvasKind =>
  CANVAS_TRANSITION_KINDS.some((known) => known === kind);

type Flight = Readonly<{
  document: GraphicsDocument;
  plan: CameraPlan;
  eagerIds: readonly string[];
  onReady: (layers: FlightLayers) => void;
}>;

type ActiveTransition = { finish: (outcome: TransitionOutcome) => void };

/**
 * Shows the current slide and plays the transition whenever it changes, like
 * Google Slides: going forward plays the entered slide's transition, going back
 * plays the left slide's transition mirrored. A change during a transition
 * finishes it at once and starts the next, so held keys never queue a backlog.
 */
export function SlideStage(props: {
  document: GraphicsDocument;
  /** Slides in presentation order. */
  slides: readonly ArtifactItem[];
  current: ArtifactItem | undefined;
  deckDefault: SlideTransition | undefined;
  interactive: boolean;
  /** Which surface plays it, for traces. */
  surface: 'present' | 'preview';
  onKey?: (key: string) => void;
  /** A transition settled; the stage shows only the current slide again. */
  onSettled?: (outcome: TransitionOutcome) => void;
}) {
  let stage!: HTMLDivElement;
  const [layers, setLayers] = createSignal<readonly string[]>([]);
  const [hiddenId, setHiddenId] = createSignal<string>();
  const [running, setRunning] = createSignal<string>();
  const [flight, setFlight] = createSignal<Flight>();
  const [flightShown, setFlightShown] = createSignal(false);
  /** Frame counts of the last transition that played, for inspection. */
  const [lastFrames, setLastFrames] = createSignal<FrameStats>();
  const elements = new Map<string, HTMLDivElement>();
  /** Resolvers waiting on each slide's first load. */
  const loadWaiters = new Map<string, Set<() => void>>();
  const loaded = new Set<string>();
  let active: ActiveTransition | undefined;

  const slide = (id: string) => props.slides.find((item) => item.id === id);
  const target = () => layers().at(-1);

  /** Resolves once the slide's frame has loaded, after `LOAD_WAIT_MS`, or
   * when the transition waiting on it ends. */
  const whenLoaded = (id: string) =>
    new Promise<void>((resolve) => {
      if (loaded.has(id)) return resolve();

      const waiters = loadWaiters.get(id) ?? new Set<() => void>();
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        if (!waiters.size && loadWaiters.get(id) === waiters)
          loadWaiters.delete(id);
        resolve();
      };
      const timer = setTimeout(done, LOAD_WAIT_MS);
      waiters.add(done);
      loadWaiters.set(id, waiters);
    });
  const resolveWaiters = (id?: string) => {
    const ids = id === undefined ? [...loadWaiters.keys()] : [id];
    for (const each of ids) {
      for (const done of [...(loadWaiters.get(each) ?? [])]) done();
      loadWaiters.delete(each);
    }
  };
  const markLoaded = (id: string) => {
    loaded.add(id);
    resolveWaiters(id);
  };

  createEffect(
    on(
      () => props.current?.id,
      (next) => {
        if (!next) {
          active?.finish('cancelled');
          setLayers([]);
          return;
        }
        if (next === target()) return;

        active?.finish('skipped');
        const shown = target();
        const from = shown ? slide(shown) : undefined;
        const to = slide(next);
        if (!from || !to) {
          setLayers([next]);
          return;
        }

        const order = props.slides.map((item) => item.id);
        const backward = order.indexOf(to.id) < order.indexOf(from.id);
        const resolved = resolveSlideTransition(
          (backward ? from : to).geometry.transition,
          props.deckDefault
        );
        if (resolved.kind === 'none') {
          setLayers([next]);
          return;
        }

        play(from, to, resolved, backward);
      }
    )
  );
  onCleanup(() => active?.finish('cancelled'));

  function play(
    from: ArtifactItem,
    to: ArtifactItem,
    requested: ResolvedSlideTransition,
    backward: boolean
  ) {
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const transition: ResolvedSlideTransition = reducedMotion
      ? {
          ...requested,
          kind: 'fade',
          durationMs: Math.min(requested.durationMs, REDUCED_MOTION_MS),
        }
      : requested;
    const interaction = beginInteraction('canvas.artifact.transition', {
      attributes: {
        'artifact.id': to.id,
        'transition.kind': transition.kind,
        'transition.requested_kind': requested.kind,
        'transition.duration_ms': transition.durationMs,
        'transition.direction': transition.direction,
        'transition.easing': transition.easing,
        'transition.backward': backward,
        'transition.reduced_motion': reducedMotion,
        'transition.surface': props.surface,
      },
    });
    // The span lasts as long as the transition, but the join window closes
    // now: clicks, views and edits during the animation start their own traces.
    const releaseSpan = interaction.hold();
    interaction.end();
    const startedAt = performance.now();
    let playingAt: number | undefined;
    let stopFrames: (() => FrameStats) | undefined;
    /** When the animations ended, and the frames they painted; a canvas kind
     * may hold its last frame after that (`holds`). */
    let animated: { at: number; stats: FrameStats; holds: boolean } | undefined;
    let animations: Animation[] = [];
    let restore = () => {};
    let done = false;

    const finish = (outcome: TransitionOutcome) => {
      if (done) return;
      done = true;
      active = undefined;

      // Remove the outgoing slide and the flight in the same task that
      // cancels the animations, so no frame shows a half-reset stage.
      setLayers([to.id]);
      setHiddenId(undefined);
      setFlight(undefined);
      setFlightShown(false);
      setRunning(undefined);
      for (const animation of animations) animation.cancel();
      restore();
      resolveWaiters();

      const now = performance.now();
      const stats = animated?.stats ?? stopFrames?.();
      const span = interaction.span;
      span.setAttr('transition.outcome', outcome);
      span.setAttr(
        'transition.wait_ms',
        Math.round((playingAt ?? now) - startedAt)
      );
      if (playingAt !== undefined)
        span.setAttr(
          'transition.played_ms',
          Math.round((animated?.at ?? now) - playingAt)
        );
      if (animated?.holds)
        span.setAttr('transition.hold_ms', Math.round(now - animated.at));
      setLastFrames(stats);
      if (stats) {
        span.setAttr('transition.frames', stats.frames);
        span.setAttr('transition.dropped_frames', stats.droppedFrames);
        span.setAttr('transition.max_frame_gap_ms', stats.maxFrameGapMs);
      }
      releaseSpan();
      props.onSettled?.(outcome);
    };
    active = { finish };

    setRunning(transition.kind);
    setHiddenId(to.id);
    setLayers([from.id, to.id]);

    /** Plays the created animations to the end, then waits for
     * `beforeComplete` while their last frame holds. */
    const begin = (
      created: Animation[],
      undo: () => void,
      beforeComplete?: () => Promise<void>
    ) => {
      if (done) {
        for (const animation of created) animation.cancel();
        undo();
        return;
      }
      animations = created;
      restore = undo;
      playingAt = performance.now();
      const stop = watchFrames();
      stopFrames = stop;
      setHiddenId(undefined);
      fireAndForget(settle(), 'canvas-slide-transition');

      async function settle() {
        const result = await ResultAsync.fromPromise(
          animationsFinished(created),
          () => 'cancelled' as const
        );
        if (result.isErr()) return finish('cancelled');
        if (done) return;

        animated = {
          at: performance.now(),
          stats: stop(),
          holds: beforeComplete !== undefined,
        };
        await beforeComplete?.();
        finish('completed');
      }
    };

    if (isCanvasKind(transition.kind)) {
      const plan = cameraPlan({
        document: props.document,
        from,
        to,
        kind: transition.kind,
        stage: { width: stage.clientWidth, height: stage.clientHeight },
        ease: easingFunction(transition.easing),
        durationMs: transition.durationMs,
      });
      interaction.span.setAttr('transition.followed_route', plan.followedRoute);
      const eagerIds =
        props.slides.length <= MAX_EAGER_SLIDES
          ? props.slides.map((item) => item.id)
          : [from.id, to.id];
      const transforms = plan.views.map((view) =>
        cameraTransform(
          view,
          { x: plan.region.x, y: plan.region.y },
          plan.baseScale,
          { width: stage.clientWidth, height: stage.clientHeight }
        )
      );
      setFlight({
        document: props.document,
        plan,
        eagerIds: eagerIds.filter((id) => props.document.items[id]),
        onReady: (flightLayers) => {
          if (done) return;
          // The flight's first frame matches the outgoing slide, so it can
          // cover the stage before the live next slide has loaded. Its last
          // frame holds until that slide has, so the swap never shows a blank.
          begin(
            animateCamera({
              ...flightLayers,
              transforms,
              durationMs: transition.durationMs,
            }),
            () => {},
            () => whenLoaded(to.id)
          );
          setFlightShown(true);
        },
      });
      return;
    }

    fireAndForget(startClassic(), 'canvas-slide-transition');

    async function startClassic() {
      await whenLoaded(to.id);
      if (done) return;

      const incoming = elements.get(to.id);
      if (!incoming) return finish('cancelled');

      const kind = transition.kind;
      if (kind === 'none' || isCanvasKind(kind)) return finish('completed');

      const { animations: created, restore: undo } = animateLayers({
        stage,
        outgoing: elements.get(from.id),
        incoming,
        keyframes: classicKeyframes(kind, transition.direction, backward, {
          width: stage.clientWidth,
          height: stage.clientHeight,
        }),
        durationMs: transition.durationMs,
        easing: easingCss(transition.easing),
      });
      begin(created, undo);
    }
  }

  return (
    <div
      ref={stage}
      class="relative size-full overflow-hidden"
      data-canvas-slide-stage
      data-canvas-transition={running()}
      data-canvas-transition-state={running() ? 'running' : 'idle'}
      data-canvas-transition-frames={lastFrames()?.frames}
      data-canvas-transition-dropped-frames={lastFrames()?.droppedFrames}
    >
      <For each={layers()}>
        {(id) => (
          <Show when={slide(id)}>
            {(item) => (
              <div
                ref={(element) => {
                  elements.set(id, element);
                  onCleanup(() => {
                    elements.delete(id);
                    loaded.delete(id);
                  });
                }}
                data-canvas-slide-layer={id}
                class="absolute inset-0"
                style={{
                  opacity: hiddenId() === id ? 0 : undefined,
                  'pointer-events':
                    target() === id && !running() ? undefined : 'none',
                }}
              >
                <ArtifactFrame
                  html={item().geometry.html}
                  title={item().geometry.title}
                  designWidth={item().geometry.designWidth}
                  designHeight={item().geometry.designHeight}
                  interactive={props.interactive}
                  eager
                  onKey={props.onKey}
                  onLoad={() => markLoaded(id)}
                />
              </div>
            )}
          </Show>
        )}
      </For>
      <Show when={flight()} keyed>
        {(spec) => (
          <div
            class="absolute inset-0 z-10"
            style={{ opacity: flightShown() ? undefined : 0 }}
          >
            <CanvasFlight
              document={spec.document}
              plan={spec.plan}
              eagerIds={spec.eagerIds}
              onReady={spec.onReady}
            />
          </div>
        )}
      </Show>
    </div>
  );
}
