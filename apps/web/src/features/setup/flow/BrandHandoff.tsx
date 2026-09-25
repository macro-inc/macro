import LogoIcon from '@icon/macro-logo.svg';
import { onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';

/** A viewport rect (getBoundingClientRect-style). */
export type HandoffRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The exact rendered loading scene captured just before it leaves the page. */
export type BrandHandoffSource = {
  /** Viewport bounds of the powered loading SVG. */
  scene: HandoffRect;
  /** Square Macro-logo box inside {@link scene}, in scene-relative pixels. */
  logo: HandoffRect;
  /** Serialized powered loading SVG, used by the transient overlay. */
  snapshot: string;
};

/**
 * `macro-logo.svg` is a *square* 24×24 viewBox, but its mark only occupies
 * y 4→20 — the full width, two thirds of the height. So rendering it in a
 * square box of side S paints the mark at width S, height S·2/3, inset S/6
 * from the box's top. Sizing the box to the mark's rect (the obvious thing)
 * therefore draws the mark a third too small.
 */
const LOGO_VIEWBOX = 24;
const LOGO_MARK_TOP = 4;

/**
 * The square box to render {@link LogoIcon} in so its *mark* lands exactly on
 * `mark`. Anchored on width, which the mark spans edge to edge.
 */
export function logoBoxForMark(mark: HandoffRect): HandoffRect {
  const side = mark.width;
  return {
    x: mark.x,
    y: mark.y - side * (LOGO_MARK_TOP / LOGO_VIEWBOX),
    width: side,
    height: side,
  };
}

/** The travel from the loading scene to the summary header's logo slot. */
const MOVE_MS = 780;
/** The graphic → logo dissolve deliberately waits until the latter half of
 *  the travel, when the scene is already compact and near its header slot.
 *  The logo leads slightly so the pair never dips dark mid-crossfade. */
const GRAPHIC_FADE_START = 0.58;
const GRAPHIC_FADE_END = 0.92;
const LOGO_FADE_START = 0.52;
const LOGO_FADE_END = 0.84;
/** Give the newly-rendered summary logo up to roughly one second to mount. */
const TARGET_RETRY_LIMIT = 60;

/**
 * Building → summary brand handoff: the powered-up loading scene shrinks to
 * the summary header's logo slot, dissolving into the real Macro logo *as* it
 * travels — the movement covers the fact that the isometric mark and the flat
 * logo aren't quite the same geometry.
 *
 * The overlay is the scene's own frame (a clone of the powered graphic filling
 * it, with the logo laid over the mark inside it), so scaling the frame moves
 * graphic and logo in lockstep and the two marks stay aligned for the whole
 * crossfade. The transform is solved so the *logo* lands on the target: both
 * it and the header slot are square boxes rendering the same square viewBox,
 * so matching them centre-to-centre with a uniform scale necessarily matches
 * the marks inside.
 *
 * Rendered through a Portal to `document.body` so `position: fixed` resolves
 * against the viewport regardless of any transformed ancestor in the flow
 * (the flow's own card mount animation ends on a non-`none` `transform`,
 * which — per spec — establishes a containing block for `fixed` descendants;
 * without the Portal this silently breaks the positioning).
 *
 * The building step's `Stepper.Step` is marked `noTransition` so it's torn
 * down the instant we advance: a fading exit would leave the original graphic
 * visible right where this clone appears, i.e. two overlapping copies.
 *
 * `onDone` fires when the move lands, so the flow can reveal the real summary
 * logo (pixel-identical to where this settled) in the same tick this is
 * dropped.
 */
export function BrandHandoff(props: {
  /** The loading scene's `.setup-graphic` rect, in viewport coords. */
  scene: HandoffRect;
  /** The logo's square box *relative to `scene`* — where the flat logo sits
   *  over the isometric mark (see {@link logoBoxForMark}). */
  logo: HandoffRect;
  /** outerHTML of the powered `.setup-graphic`, cloned to fill the frame. */
  snapshot: string;
  /** Selector for the destination logo (rendered on the summary step). */
  targetSelector: string;
  onDone: () => void;
}) {
  let frame: HTMLDivElement | undefined;
  let graphicEl: HTMLDivElement | undefined;
  let logoEl: HTMLDivElement | undefined;
  let raf1 = 0;
  let raf2 = 0;
  let targetRetries = 0;
  const anims: Animation[] = [];
  onCleanup(() => {
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
    for (const anim of anims) anim.cancel();
  });

  onMount(() => {
    const run = () => {
      const target = document.querySelector(props.targetSelector);
      if (!target || !frame) {
        targetRetries += 1;
        if (targetRetries >= TARGET_RETRY_LIMIT) {
          props.onDone();
          return;
        }
        raf1 = requestAnimationFrame(run);
        return;
      }
      const to = target.getBoundingClientRect();
      // `transform-origin` is the frame's top-left, so a point (lx, ly) local
      // to the frame lands at (scene.x + lx·scale + dx, …). Solve for the
      // logo's local box to land on the target.
      const scale = to.width / props.logo.width;
      const dx = to.x - props.scene.x - props.logo.x * scale;
      const dy = to.y - props.scene.y - props.logo.y * scale;

      const timing = {
        duration: MOVE_MS,
        easing: 'cubic-bezier(0.6, 0, 0.2, 1)',
        fill: 'forwards' as const,
      };
      const move = frame.animate(
        [
          { transform: 'translate(0px, 0px) scale(1)' },
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        ],
        timing
      );
      anims.push(move);
      // Dissolve during the travel. Linear so the two halves cross evenly
      // (the move's own easing already carries the motion's character).
      if (graphicEl) {
        anims.push(
          graphicEl.animate(
            [
              { opacity: 1, offset: 0 },
              { opacity: 1, offset: GRAPHIC_FADE_START },
              { opacity: 0, offset: GRAPHIC_FADE_END },
              { opacity: 0, offset: 1 },
            ],
            { duration: MOVE_MS, easing: 'linear', fill: 'forwards' }
          )
        );
      }
      if (logoEl) {
        anims.push(
          logoEl.animate(
            [
              { opacity: 0, offset: 0 },
              { opacity: 0, offset: LOGO_FADE_START },
              { opacity: 1, offset: LOGO_FADE_END },
              { opacity: 1, offset: 1 },
            ],
            { duration: MOVE_MS, easing: 'linear', fill: 'forwards' }
          )
        );
      }
      move.finished.then(props.onDone).catch(() => {});
    };
    // Two rAFs: the summary step's DOM has just swapped in; this lets layout
    // settle before measuring its logo slot, without a guessed timeout.
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(run);
    });
  });

  return (
    <Portal>
      <div
        ref={frame}
        aria-hidden="true"
        class="pointer-events-none fixed z-[60]"
        style={{
          left: `${props.scene.x}px`,
          top: `${props.scene.y}px`,
          width: `${props.scene.width}px`,
          height: `${props.scene.height}px`,
          'transform-origin': 'top left',
        }}
      >
        {/* The powered scene, filling the frame exactly as it did in place. */}
        <div
          ref={graphicEl}
          class="absolute inset-0 [&_svg]:size-full [&_svg]:overflow-visible"
          innerHTML={props.snapshot}
        />
        {/* The flat logo, laid over the scene's mark inside the same frame. */}
        <div
          ref={logoEl}
          class="absolute text-accent"
          style={{
            left: `${props.logo.x}px`,
            top: `${props.logo.y}px`,
            width: `${props.logo.width}px`,
            height: `${props.logo.height}px`,
            opacity: 0,
          }}
        >
          <LogoIcon class="size-full" />
        </div>
      </div>
    </Portal>
  );
}
