import { useReactiveColorString } from '@theme/signals/themeReactive';
import { createEffect, For, on, onCleanup, onMount, Show } from 'solid-js';
import { Module, type ModuleLogo, type ModuleState } from './Module';
import { MODULE_LOGOS } from './moduleLogos';
import './SetupGraphic.css';

type Point = { x: number; y: number };
type ConnectorLayer = 'front' | 'mid' | 'back';
type ConnectorAxis = 'frontFace' | 'sideFace';

const point = (x: number, y: number): Point => ({ x, y });
const toSvgNumber = (value: number) => Number(value.toFixed(1));

const SCENE = {
  viewBox: '-10 -28 930 700',
  blocks: {
    center: point(444, 457),
    scale: 0.667,
    inverseScale: 1.49925,
  },
  module: {
    scale: 0.667,
    // The point on the module body where each tether originates. Slots may
    // opt into a different local point when their face needs a slight nudge.
    defaultConnectorAnchor: point(397.5, 140),
  },
} as const;

const MOTION = {
  downloadPulse: {
    segmentLength: 70,
    millisecondsPerUnit: 3,
  },
  leds: {
    staggerMs: 110,
    onsetMs: 300,
    haloFlashMs: 450,
    breatheMs: 2600,
    halo: {
      startScale: 0.7,
      peakScale: 2.4,
      restingScale: 0.85,
      peakOpacity: 0.6,
      restingOpacity: 0.28,
      breatheScale: 1.2,
      breatheOpacity: 0.14,
    },
  },
  cardSlide: {
    delayMs: 800,
    durationMs: 2600,
    outOffset: 0.2,
    holdOffset: 0.4,
    distance: point(34.8, 33.1),
  },
  modulePhaseMs: 1100,
} as const;

const connectorAxisSlopes: Record<ConnectorAxis, number> = {
  // The two non-vertical axes in the isometric artwork. Keeping these shared
  // means a tether's lower arm stays aligned to its card face as its module
  // moves; only the slot's placement needs updating.
  frontFace: -0.4,
  sideFace: 0.948,
};

const moduleTransform = (position: Point, moduleAnchor: Point) =>
  `translate(${position.x} ${position.y}) scale(${SCENE.module.scale}) translate(${-moduleAnchor.x} ${-moduleAnchor.y})`;

const transformModulePoint = (
  position: Point,
  moduleAnchor: Point,
  localPoint: Point
): Point => ({
  x: position.x + SCENE.module.scale * (localPoint.x - moduleAnchor.x),
  y: position.y + SCENE.module.scale * (localPoint.y - moduleAnchor.y),
});

const connectorPath = (start: Point, target: Point, axis: ConnectorAxis) => {
  const elbow = point(
    start.x,
    target.y - connectorAxisSlopes[axis] * (target.x - start.x)
  );
  return `M${toSvgNumber(start.x)} ${toSvgNumber(start.y)} L${toSvgNumber(elbow.x)} ${toSvgNumber(elbow.y)} L${toSvgNumber(target.x)} ${toSvgNumber(target.y)}`;
};

/**
 * A "downloading" pulse: an accent glow segment that travels along a connector
 * from the module to the card, on repeat. Built from a short dash swept with
 * stroke-dashoffset (WAAPI, so a Suspense re-attach can't restart it). Rendered
 * in the same layer as its connector, so it's occluded by the cards the same
 * way. The connector `d` runs module→card, so the pulse flows that direction.
 */
function DownloadPulse(props: { d: string }) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return null;
  }

  let path: SVGPathElement | undefined;
  let animation: Animation | undefined;
  onCleanup(() => animation?.cancel());
  onMount(() => {
    if (!path) return;
    const total = path.getTotalLength();
    const { segmentLength, millisecondsPerUnit } = MOTION.downloadPulse;
    // One bright dash, gap = full path (so only one is on the wire at a time);
    // sweeping the whole period runs it start→end and loops seamlessly.
    path.setAttribute('stroke-dasharray', `${segmentLength} ${total}`);
    animation = path.animate(
      [
        { strokeDashoffset: '0' },
        { strokeDashoffset: `${-(segmentLength + total)}` },
      ],
      {
        duration: Math.round((segmentLength + total) * millisecondsPerUnit),
        iterations: Number.POSITIVE_INFINITY,
        easing: 'linear',
      }
    );
  });
  return <path ref={path} class="download-pulse" d={props.d} />;
}

/**
 * The fixed module positions around the blocks. Each slot is pure geometry —
 * where the module sits (`position`, mapped from its local `moduleAnchor`) and
 * the dashed tether to a block feature (`connector`) — independent of which
 * logo lands on it.
 *
 * A connector's `layer` sets its draw order: `front` over all cards; `back`
 * behind all cards; `mid` between the back and middle cards. Coordinates are
 * absolute viewBox units (modules/connectors are siblings of the scaled
 * blocks), so the `mid` group counters the blocks transform to stay so.
 */
type Slot = {
  // Move a module by changing only this position; its tether follows.
  position: Point;
  moduleAnchor: Point;
  connector: {
    target: Point;
    axis: ConnectorAxis;
    layer: ConnectorLayer;
    source?: Point;
  };
};

const createSlot = (slot: Slot) => {
  const connectorAnchor =
    slot.connector.source ?? SCENE.module.defaultConnectorAnchor;
  const connectorStart = transformModulePoint(
    slot.position,
    slot.moduleAnchor,
    connectorAnchor
  );

  return {
    place: moduleTransform(slot.position, slot.moduleAnchor),
    connector: {
      d: connectorPath(
        connectorStart,
        slot.connector.target,
        slot.connector.axis
      ),
      layer: slot.connector.layer,
    },
  };
};

const SLOTS = {
  // Tethers to the pill cutout on the front card.
  frontPill: createSlot({
    position: point(90, 275),
    moduleAnchor: point(447.5, 48.3),
    connector: {
      target: point(228.7, 495.4),
      axis: 'frontFace',
      layer: 'front',
    },
  }),
  // Tethers to the back side of the middle card.
  midBack: createSlot({
    position: point(270, 190),
    moduleAnchor: point(447.5, 168.3),
    connector: {
      target: point(374.6, 442.3),
      axis: 'sideFace',
      layer: 'back',
      source: point(397.5, 146.3),
    },
  }),
  // Tethers to the small circular port on the middle card.
  midPort: createSlot({
    position: point(410, 145),
    moduleAnchor: point(447.5, -98.3),
    connector: {
      target: point(429.5, 556.8),
      axis: 'frontFace',
      layer: 'front',
    },
  }),
  // Tethers to the far side of the middle card.
  midFar: createSlot({
    position: point(670, 210),
    moduleAnchor: point(507.5, 128.3),
    connector: {
      target: point(489.8, 465.7),
      axis: 'frontFace',
      layer: 'mid',
      source: point(397.5, 134.3),
    },
  }),
  // Tethers to the far side of the back card.
  backFar: createSlot({
    position: point(855, 290),
    moduleAnchor: point(507.5, 248.3),
    connector: {
      target: point(694.8, 465.7),
      axis: 'frontFace',
      layer: 'back',
      source: point(397.5, 139.6),
    },
  }),
} satisfies Record<
  string,
  { place: string; connector: { d: string; layer: ConnectorLayer } }
>;

type SlotName = keyof typeof SLOTS;

/** One module to render: which {@link SLOTS slot} it fills, its logo, whether
 *  to draw its connector (default true), and its activity `state` (default
 *  'idle'). `downloading` runs the connector pulse; `linked` hides the
 *  connector. */
export type ModuleConfig = {
  slot: SlotName;
  logo: ModuleLogo;
  connector?: boolean;
  state?: ModuleState;
};

/** Default: every slot filled with its conventional brand logo, connectors on.
 *  Slots are geometry-named, so the logo for each is spelled out here. */
const DEFAULT_MODULES: ModuleConfig[] = [
  { slot: 'frontPill', logo: MODULE_LOGOS.Linear },
  { slot: 'midBack', logo: MODULE_LOGOS.Google },
  { slot: 'midPort', logo: MODULE_LOGOS.GitHub },
  { slot: 'midFar', logo: MODULE_LOGOS.Notion },
  { slot: 'backFar', logo: MODULE_LOGOS.Slack },
];

/**
 * Undoes the `.blocks` transform, so a connector placed among the blocks'
 * children (to sit at a specific card in the draw order) still renders at its
 * absolute viewBox coordinates.
 */
const INVERSE_BLOCKS_TRANSFORM = `translate(${SCENE.blocks.center.x} ${SCENE.blocks.center.y}) scale(${SCENE.blocks.inverseScale}) translate(${-SCENE.blocks.center.x} ${-SCENE.blocks.center.y})`;

const BLOCKS_TRANSFORM = `translate(${SCENE.blocks.center.x} ${SCENE.blocks.center.y}) scale(${SCENE.blocks.scale}) translate(${-SCENE.blocks.center.x} ${-SCENE.blocks.center.y})`;

/**
 * The isometric empty-state scene for `/setup`: the Macro logo re-imagined as
 * three technical isometric blocks (`front_card`, `middle_card`, `back_card`),
 * with hovering modules around it. Inlined (rather than imported as an asset)
 * so animation can target the named groups.
 *
 * Pass `modules` to choose which {@link SLOTS slots} appear and which logo each
 * carries (and whether to draw each tether); omit it for all five slots with
 * their brand logos. Each connector follows its module.
 *
 * The back card's front section (`animating_card`) slides out and back once on
 * mount; clicking the graphic replays it. When it settles, the inset LED
 * indicators illuminate bottom-to-top and hold a faint pulsing glow with a
 * breathing halo; a fresh slide darkens them until it settles again.
 */
export function SetupGraphic(props: {
  class?: string;
  modules?: ModuleConfig[];
  /** The composite-level "powered up" finale: the modules fade out and the
   *  three cards fill in accent with their shading gone. Independent of any
   *  module's `linked` state. */
  poweredUp?: boolean;
}) {
  const accentColor = useReactiveColorString('a0');
  const inkColor = useReactiveColorString('c0');
  const modules = () => props.modules ?? DEFAULT_MODULES;
  // Connectors follow their modules: one per shown module whose connector
  // isn't disabled and isn't in the `linked` state (which hides it), carrying
  // the slot's tether geometry + draw layer, plus whether its pulse is running.
  const connectorsIn = (layer: ConnectorLayer) =>
    modules()
      .filter(
        (m) =>
          m.connector !== false &&
          m.state !== 'linked' &&
          SLOTS[m.slot].connector.layer === layer
      )
      .map((m) => ({
        ...SLOTS[m.slot].connector,
        downloading: m.state === 'downloading',
      }));

  let svg: SVGSVGElement | undefined;
  let animatingCard: SVGGElement | undefined;
  let slideAnimation: Animation | undefined;
  let slideDelay: ReturnType<typeof setTimeout> | undefined;
  // The LEDs, ordered bottom-to-top (illumination order): each carries its
  // inset dot, halo ring, and specular spark. Plus the WAAPI animations
  // currently driving them.
  type Led = {
    inset: SVGElement;
    halo: SVGElement | null;
    spark: SVGElement | null;
  };
  let leds: Led[] = [];
  let ledAnimations: Animation[] = [];
  onCleanup(() => {
    clearTimeout(slideDelay);
    for (const animation of ledAnimations) animation.cancel();
  });

  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const darkenLeds = () => {
    for (const animation of ledAnimations) animation.cancel();
    ledAnimations = [];
  };

  // Light the LEDs bottom-to-top: each ramps from its resting ink dot to a
  // glowing accent dot with a white specular spark (staggered onset) while
  // its halo flashes big, then settles into an endless faint pulse with a
  // breathing halo. Driven with WAAPI so a Suspense re-attach can't replay
  // the onset.
  const illuminateLeds = () => {
    darkenLeds();
    const accent = accentColor();
    const ink = inkColor();
    const lit = `drop-shadow(0 0 1.5px ${accent})`;
    const bright = `drop-shadow(0 0 4px ${accent})`;
    const motion = !reducedMotion();

    leds.forEach(({ inset, halo, spark }, index) => {
      const delay = index * MOTION.leds.staggerMs;
      const onset = inset.animate(
        [
          { fill: ink, opacity: 0.4, filter: 'drop-shadow(0 0 0 transparent)' },
          { fill: accent, opacity: 1, filter: lit },
        ],
        {
          duration: MOTION.leds.onsetMs,
          delay,
          easing: 'ease-out',
          fill: 'both',
        }
      );
      ledAnimations.push(onset);
      // Spark fades in over the same onset window and holds.
      if (spark) {
        ledAnimations.push(
          spark.animate([{ opacity: 0 }, { opacity: 0.9 }], {
            duration: MOTION.leds.onsetMs,
            delay,
            easing: 'ease-out',
            fill: 'both',
          })
        );
      }
      // Halo flashes big as the LED comes on, then settles to the breathe
      // baseline; the endless breathe picks up from there. (Motion only —
      // reduced-motion leaves the halo hidden.)
      if (halo && motion) {
        const flash = halo.animate(
          [
            { transform: `scale(${MOTION.leds.halo.startScale})`, opacity: 0 },
            {
              transform: `scale(${MOTION.leds.halo.peakScale})`,
              opacity: MOTION.leds.halo.peakOpacity,
              offset: 0.45,
            },
            {
              transform: `scale(${MOTION.leds.halo.restingScale})`,
              opacity: MOTION.leds.halo.restingOpacity,
            },
          ],
          {
            duration: MOTION.leds.haloFlashMs,
            delay,
            easing: 'ease-out',
            fill: 'both',
          }
        );
        ledAnimations.push(flash);
        flash.finished
          .then(() => {
            // Breathe: expand and contract, synced with the glow pulse.
            const breathe = halo.animate(
              [
                {
                  transform: `scale(${MOTION.leds.halo.restingScale})`,
                  opacity: MOTION.leds.halo.restingOpacity,
                },
                {
                  transform: `scale(${MOTION.leds.halo.breatheScale})`,
                  opacity: MOTION.leds.halo.breatheOpacity,
                },
                {
                  transform: `scale(${MOTION.leds.halo.restingScale})`,
                  opacity: MOTION.leds.halo.restingOpacity,
                },
              ],
              {
                duration: MOTION.leds.breatheMs,
                iterations: Number.POSITIVE_INFINITY,
                easing: 'ease-in-out',
              }
            );
            ledAnimations.push(breathe);
          })
          .catch(() => {
            // finished rejects when darkenLeds() cancels the flash.
          });
      }
      onset.finished
        .then(() => {
          if (!motion) return;
          const pulse = inset.animate(
            [
              { filter: lit, opacity: 1 },
              { filter: bright, opacity: 0.9 },
              { filter: lit, opacity: 1 },
            ],
            {
              duration: MOTION.leds.breatheMs,
              iterations: Number.POSITIVE_INFINITY,
            }
          );
          ledAnimations.push(pulse);
        })
        .catch(() => {
          // finished rejects when darkenLeds() cancels a pending onset.
        });
    });
  };

  // Slide the back card's front section out and back once along its pipes —
  // the isometric depth axis, unit vector (0.7245, 0.6892) from the pipe
  // paths (e.g. "M740.7,486.2 l-51.3,-48.8"), in user units so it scales
  // with the scene. Driven imperatively (WAAPI) rather than by a CSS
  // animation: the page's Suspense boundary re-attaches this subtree when a
  // query above it re-suspends (e.g. failing queries retrying), and
  // re-inserted elements cancel and replay CSS animations, while WAAPI
  // animations survive.
  const playSlide = () => {
    if (props.poweredUp) return; // no card slide in the static powered finale
    if (!animatingCard || slideAnimation?.playState === 'running') return;
    darkenLeds();
    slideAnimation = animatingCard.animate(
      [
        {
          transform: 'translate(0, 0)',
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        },
        {
          transform: `translate(${MOTION.cardSlide.distance.x}px, ${MOTION.cardSlide.distance.y}px)`,
          offset: MOTION.cardSlide.outOffset,
          easing: 'linear',
        },
        {
          transform: `translate(${MOTION.cardSlide.distance.x}px, ${MOTION.cardSlide.distance.y}px)`,
          offset: MOTION.cardSlide.holdOffset,
          easing: 'cubic-bezier(0.3, 0, 0.2, 1)',
        },
        { transform: 'translate(0, 0)' },
      ],
      { duration: MOTION.cardSlide.durationMs }
    );
    slideAnimation.finished.then(illuminateLeds).catch(() => {
      // finished rejects if a fresh slide cancels this one; that slide
      // owns the next illuminate.
    });
  };

  onMount(() => {
    const groups = svg ? [...svg.querySelectorAll<SVGGElement>('.led')] : [];
    leds = groups
      .flatMap((group) => {
        const inset = group.querySelector<SVGElement>('.led-inset');
        if (!inset) return [];
        const halo = group.querySelector<SVGGraphicsElement>('.led-halo');
        const spark = group.querySelector<SVGGraphicsElement>('.led-spark');
        // Fit the halo/spark to the inset's geometry (getBBox is transform-
        // independent, so this is correct even mid-slide).
        const box = (inset as SVGGraphicsElement).getBBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        if (halo) {
          // Nudge the halo center down-and-right off the inset center, so the
          // glow sits slightly below/ahead of the bulb rather than dead on.
          halo.setAttribute('cx', `${cx + box.width * 0.22}`);
          halo.setAttribute('cy', `${cy + box.height * 0.32}`);
          halo.setAttribute('r', `${Math.max(box.width, box.height) * 0.9}`);
        }
        if (spark) {
          // Upper-left of the ellipse — the implied light source.
          spark.setAttribute('cx', `${box.x + box.width * 0.3}`);
          spark.setAttribute('cy', `${box.y + box.height * 0.28}`);
          spark.setAttribute('r', `${box.width * 0.13}`);
        }
        return [{ inset, halo, spark, cy }];
      })
      // Illuminate bottom-to-top by screen height (larger y = lower = first),
      // so the front card's LED joins the back card's sweep by position.
      .sort((a, b) => b.cy - a.cy)
      .map(({ inset, halo, spark }) => ({ inset, halo, spark }));
    // Powered from the start: skip the slide + LED sweep — the finale is a
    // static state (cards filled, modules faded, LEDs dark), driven by CSS.
    if (props.poweredUp) return;
    if (reducedMotion()) {
      // No slide, no pulse — just show the LEDs already lit.
      illuminateLeds();
      return;
    }
    slideDelay = setTimeout(playSlide, MOTION.cardSlide.delayMs);
  });

  // Powering up/down after mount. On: cancel any pending slide and kill the
  // LED animations, so the white sparks (and halos) return to their hidden
  // CSS resting state under `.powered` — a running WAAPI animation would
  // otherwise keep them lit over the CSS. Off: relight the LEDs. Deferred, so
  // the initial state is left to onMount above.
  createEffect(
    on(
      () => props.poweredUp,
      (powered) => {
        if (powered) {
          clearTimeout(slideDelay);
          darkenLeds();
        } else if (leds.length && !reducedMotion()) {
          illuminateLeds();
        }
      },
      { defer: true }
    )
  );

  return (
    <svg
      ref={svg}
      // Framed tightly to the actual content (modules + blocks + connectors),
      // not the original artboard: the top module's rings sit above the old
      // y=0 and were clipped, and the artboard left ~140 units of dead space
      // below the blocks. The padding absorbs the modules' bob/breathe. `meet`
      // then always shows the whole scene, and the tighter frame keeps the
      // modules near the top edge and the blocks near the bottom.
      viewBox={SCENE.viewBox}
      fill="currentColor"
      class={`setup-graphic text-ink ${props.poweredUp ? 'powered ' : ''}${props.class ?? ''}`}
      onClick={playSlide}
      aria-hidden="true"
    >
      <g class="scene">
        {/* Tethers that sit behind every card. */}
        <g class="connectors">
          <For each={connectorsIn('back')}>
            {(connector) => (
              <>
                <path class="connector" d={connector.d} />
                <Show when={connector.downloading}>
                  <DownloadPulse d={connector.d} />
                </Show>
              </>
            )}
          </For>
        </g>
        {/* The block assembly, shrunk to 2/3 about its center so the modules
            can orbit farther out around it. */}
        <g class="blocks" transform={BLOCKS_TRANSFORM}>
          <g id="back_card">
            <g id="stable_card">
              <path
                class="card-back"
                d="M743.3,606l-60.4,24.1-6.7-3.6-173.4-164.4v-239.6l2.4-6.8,4.4-2.2,53.7-21.5,6.7,3.6,173.4,164.4v245.9Z"
              />
              <path class="guide" d="M513.1,217l166.3,157.7" />
              <path class="guide" d="M676.2,619v-73.3" />
              <path
                class="arc"
                d="M634.9,458.9c2.7-13,12.4-15.3,23.9-4.3l17.3,16.4"
              />
              <path
                class="vent"
                d="M673.9,540.3l-15-14.2c-13.6-12.9-24.7-39.4-24.7-59.1s0-1.9,0-2.8"
              />
              <path
                class="vent"
                d="M535.4,221.2c1.8-3.6,5.5-6.8,11-9,12.4-5,29-2.8,37.1,4.8h0s33.1,31.5,33.1,31.5c2.5,2.4,3.9,5,4.2,7.7"
              />
              <path
                class="arc"
                d="M620.1,261.5c-1.6,3.9-5.5,7.5-11.4,9.8-12.4,5-29,2.8-37-4.8l-33.2-31.5h0c-3.8-3.6-5-7.7-4-11.6"
              />
              <path
                class="vent"
                d="M536.9,225.2c2.1-2.6,5.3-5,9.5-6.7,12.4-5,29-2.8,37.1,4.8l33.2,31.5"
              />
              <path class="guide" d="M676.2,465.7v-78.7l6.7-9,53.7-21.5" />
              <path
                class="card-back"
                d="M783.3,526.6l-73-69.2-34,13.6-17.3-16.4c-8.7,4.5-12.2,8.2-12.2,8.2-3.5,14.1,4.8,22.6,4.8,22.6l89.2,84.6"
              />
              <path
                class="knob"
                d="M743.3,572c-4.1-2.6-6.6-7.2-6.6-13.4,0-13.2,11.4-28.5,25.5-34.1,14.1-5.6,25.5.5,25.5,13.7s-11.4,28.5-25.5,34.1-14.2,2.6-18.8-.3"
              />
              <path class="guide" d="M678.9,541.1l22.1-8.8" />
              <path
                class="card-back"
                d="M740.7,486.2l-51.3-48.8c-3-2.7-4.8-6.8-4.8-12.1,0-13.2,11.4-28.5,25.5-34.1,9.3-3.7,17.4-2.3,21.8,2.9l51.5,48.8"
              />
              <path
                class="knob"
                d="M743.3,488.3c-4.1-2.6-6.6-7.2-6.6-13.4,0-13.2,11.4-28.5,25.5-34.1,14.1-5.6,25.5.5,25.5,13.7s-11.4,28.5-25.5,34.1-14.2,2.6-18.8-.3"
              />
              <path
                class="card-back"
                d="M740.7,653.7l-51.3-48.8c-3-2.7-4.8-6.8-4.8-12.1,0-13.2,11.4-28.5,25.5-34.1,9.3-3.7,17.4-2.3,21.8,2.9l51.5,48.8"
              />
              <path
                class="knob"
                d="M743.3,655.8c-4.1-2.6-6.6-7.2-6.6-13.4,0-13.2,11.4-28.5,25.5-34.1,14.1-5.6,25.5.5,25.5,13.7s-11.4,28.5-25.5,34.1-14.2,2.6-18.8-.3"
              />
              <line class="vent" x1="513.3" y1="394" x2="513.3" y2="457.6" />
              <line class="vent" x1="518.2" y1="397.5" x2="518.2" y2="462.2" />
              <line class="vent" x1="523.4" y1="402.6" x2="523.4" y2="467.2" />
              <path class="guide" d="M563.9,222.1l-21.2,8.5" />
              <path class="guide" d="M609.1,262.9l-21.2,8.5" />
              <g class="dot">
                <path d="M565.5,229c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M573,231.8c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M574.1,237.1c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M581.6,239.9c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M582.7,245.3c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M590.2,248.1c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M591.3,253.4c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M598.8,256.2c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M599.9,261.6c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M559.1,231.5c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M566.6,234.3c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M567.7,239.7c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M575.2,242.5c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M576.3,247.8c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M583.8,250.6c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M584.9,256c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M592.4,258.8c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M593.5,264.1c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M552.7,234.1c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M560.2,236.9c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M561.3,242.2c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M568.8,245c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M569.9,250.4c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M577.4,253.2c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M578.5,258.5c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M586,261.3c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M587.1,266.7c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M553.8,239.4c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M562.4,247.6c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M571,255.7c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
                <path d="M579.6,263.9c-.8.3-2,.2-2.5-.3s-.3-1.2.5-1.5,2-.2,2.5.3.3,1.2-.5,1.5Z" />
              </g>
              <path
                class="guide"
                d="M507.1,261.5l67.4,63.9v-18.2h.8s91.5,86.7,91.5,86.7v58.6"
              />
              {/* Stable half of the back card's left-face shading. The
                  Illustrator export had one polygon spanning the whole
                  assembly; it's split along the sliding piece's outline so
                  the moving half (in animating_card) travels with the
                  slide. */}
              <path
                class="shade"
                d="M502.8,222.6 L685.5,396 L685.5,480 L702.2,495.9 C715.8,508.8 726.9,535.3 726.9,557 L706.7,537.8 L704.9,539.7 L692.6,548.8 L685.7,551.5 L685.7,635.5 L502.8,462.1 Z"
              />
            </g>
            <g id="animating_card" ref={animatingCard}>
              <path
                class="panel"
                d="M837.9,514.7l2.1-6.2v-56.6l-87.4-82.9-6.7-3.6-53.7,21.5-6.7,9v84.1l16.7,15.9c13.6,12.9,24.7,39.4,24.7,59.1s0,1.9,0,2-.2-.1-.2-.1l-20.2-19.2-.7.9-1.1,1-12.3,9.1-6.9,2.7v84.1l87.4,82.9,6.7,3.6,53.7-21.5,4.4-2.2,2.4-6.8v-57l-1.3-2.7h0s1.3-3.8,1.3-3.8v-112.4l-2.1-.8Z"
              />
              <path class="guide" d="M830.7,637.5l7-2.8,1-3" />
              <path class="guide" d="M838.6,512.7l-2.4,6.8-6.2,2.6" />
              <path class="edge" d="M793.5,705.9v-47l-1.6-7.4" />
              <path class="guide" d="M816.8,681.3l7.9,7.5" />
              <path
                class="edge"
                d="M814.6,477.9l2.3,4.5,1.9,4.3,1.7,4.4,1.5,4.5,1.3,4.5,1.1,4.4,1.2,6.5.5,4.2.3,5.8v134.3s-.2,3.9-.2,3.9l-.4,3.5-.7,3.2-1.1,3.8-1.7,4-1.3,2.3-1.5,2.2-2.6,3-4.1,3.3-4.6,2.3-5,1.3-4,.3-5.7-.6"
              />
              <path class="guide" d="M830.1,449.5l-50.4,20.2-84.6-80.2" />
              <path
                class="guide"
                d="M828.2,475.4v43.8l-1.7,4.7,1.7,2.3v112.4l-1.7-1,1.7,7.6v47l-31.3,12.5"
              />
              <path
                class="edge"
                d="M791.9,651.5l1.6-5v-106.6l-1.7-2.1,1.7-4.8v-46.7l34.6-13.8"
              />
              <path
                class="guide"
                d="M789.4,538.8l-5.6,2.2-10.5-1.4-41.3-9.4v57.6c-.1,0,41,66.8,41,66.8l11.1,1.4,5.3-2.1"
              />
              <path
                class="vent"
                d="M726.9,556.8c0,19.7-11,25.2-24.7,12.3l-13.6-14.6"
              />
              <line class="vent" x1="693.6" y1="430.6" x2="693.6" y2="474.6" />
              <line class="vent" x1="698.5" y1="434.9" x2="698.5" y2="479.2" />
              {/* Three inset LED indicators (top → bottom in source order).
                  Each is a ring (arc/vent arcs) around an inset dot
                  (dot.led-inset); the illuminate pass lights the dot, fades
                  in the white specular spark, and pulses the halo ring. The
                  halo/spark circles are positioned onto the inset at mount
                  (getBBox), so their placeholder geometry here is unused. */}
              <g class="led">
                <circle class="led-halo" />
                <path
                  class="arc"
                  d="M812.7,572.7c-2-.5-3.2-2-3.2-4.4,0-3.8,3.3-8.2,7.3-9.8s4.8-.7,6.1.6"
                />
                <path
                  class="vent"
                  d="M824.2,562.4c0,3.8-3.3,8.2-7.3,9.8s-1,.4-1.5.5"
                />
                <path
                  class="dot led-inset"
                  d="M819.2,562c0,2-1.8,4.4-3.9,5.3s-3.9,0-3.9-2.1,1.8-4.4,3.9-5.3,3.9,0,3.9,2.1Z"
                />
                <circle class="led-spark" />
              </g>
              <g class="led">
                <circle class="led-halo" />
                <path
                  class="arc"
                  d="M812.7,597.7c-2-.5-3.2-2-3.2-4.4,0-3.8,3.3-8.2,7.3-9.8s4.8-.7,6.1.6"
                />
                <path
                  class="vent"
                  d="M824.2,587.4c0,3.8-3.3,8.2-7.3,9.8s-1,.4-1.5.5"
                />
                <path
                  class="dot led-inset"
                  d="M819.2,587c0,2-1.8,4.4-3.9,5.3s-3.9,0-3.9-2.1,1.8-4.4,3.9-5.3,3.9,0,3.9,2.1Z"
                />
                <circle class="led-spark" />
              </g>
              <g class="led">
                <circle class="led-halo" />
                <path
                  class="arc"
                  d="M812.7,622.7c-2-.5-3.2-2-3.2-4.4,0-3.8,3.3-8.2,7.3-9.8s4.8-.7,6.1.6"
                />
                <path
                  class="vent"
                  d="M824.2,612.4c0,3.8-3.3,8.2-7.3,9.8s-1,.4-1.5.5"
                />
                <path
                  class="dot led-inset"
                  d="M819.2,612c0,2-1.8,4.4-3.9,5.3s-3.9,0-3.9-2.1,1.8-4.4,3.9-5.3,3.9,0,3.9,2.1Z"
                />
                <circle class="led-spark" />
              </g>
              {/* Moving half of the back card's left-face shading — lives in
                  this group so it slides with the piece. */}
              <path
                class="shade"
                d="M685.5,396 L773,479.2 L773,718.3 L685.7,635.5 L685.7,551.5 L692.6,548.8 L704.9,539.7 L706.7,537.8 L726.9,557 C726.9,535.3 715.8,508.8 702.2,495.9 L685.5,480 Z"
              />
            </g>
          </g>
          {/* Tethers behind the middle card but in front of the back card.
              Counter-transformed so their absolute coords survive being
              nested in the scaled blocks group. */}
          <g class="connectors" transform={INVERSE_BLOCKS_TRANSFORM}>
            <For each={connectorsIn('mid')}>
              {(connector) => (
                <>
                  <path class="connector" d={connector.d} />
                  <Show when={connector.downloading}>
                    <DownloadPulse d={connector.d} />
                  </Show>
                </>
              )}
            </For>
          </g>
          <g id="middle_card">
            <path
              class="card-mid"
              d="M204.8,268.2l-14.7,5.9-2.4,6.8v180.9h0s110.7,105,110.7,105l3.1,1.7v1.3l43.4,41.2,2.9,1.6v1.3c0,0,110,104.2,110,104.2l6.7,3.6,53.7-21.5,4.4-2.2,2.4-6.8v-239.6l-214.8-203.6-6.7-3.6-15.1,6-14.1-13.4-2.4-2.1-3.6-2.5-2.4-1.3-2.4-1-3.7-1-2.6-.3h-2.2s-2.5.4-2.5.4l-2.4.7-3.2,1.6-2.8,2.3-1.4,1.6-2.6-.2-2.6.2-3.5.9-2.3,1.1-1.8,1.1-2,1.7-1.4,1.6-2.6-.2-3.6.4-2.4.7-3.2,1.6-2.8,2.3-1.7,2-1.3,1.9-1.8,3.5-1.5,5.3-.5,3-.2,2.7v3.3c-.1,0-.1,0-.1,0Z"
            />
            <path class="edge" d="M347.6,494.2l-1.5-3.9-44-41.7-.7,3.8v112.6" />
            <path class="guide" d="M347.6,608.6v-112" />
            <path class="guide" d="M510,693l-28.1,11.2" />
            <path class="guide" d="M500.7,680.8l9.3,8.8" />
            <path
              class="edge"
              d="M477.9,685.3l2.5.2,5.2-.6,3.8-1.1,1.1-.5,3.5-1.9,1-.7,3.1-2.5,3.4-4.1,2.6-4.7,1.1-2.8.7-2.4,1.1-4.7.4-3.5.2-3.9v-134.3s-.3-5.8-.3-5.8l-.5-4.2-.8-4.3-1-4.4-1.2-4.5-1.4-4.5-1.6-4.5-3.3-7.6"
            />
            <path
              class="edge"
              d="M272.3,256.8l-14.1-13.4-3.6-3-2.4-1.6-3.6-1.9-3.7-1.2-2.2-.4"
            />
            <path
              class="edge"
              d="M256.2,263.3l-14.1-13.4-2.4-2.1-1.9-1.4-2.9-1.8-2.4-1.2-3.7-1.2-2.2-.4"
            />
            <path class="guide" d="M239.8,330.2l-48.5-46" />
            <path class="edge" d="M288.4,250.4l-38.6,15.4-6.7,9v58.6" />
            <path class="guide" d="M253.4,269.2l211.2,200.2,51.1-20.4" />
            <path
              class="hairline"
              d="M242.7,275.9l-14.7-12.9-2.3-1.6-1,.5-.7,4.3v1.5s0,16.9,0,16.9c0,1.9-1.5,3.6-4.3,4.7-4.5,1.8-10.4,1-13.3-1.7s-1.5-2-1.5-3v-16.3"
            />
            <path
              class="hairline"
              d="M224.3,282.7c2.8.7,6.2.6,9-.5s4.3-2.8,4.3-4.7v-6.1"
            />
            <path class="guide" d="M512.6,476.4v210.8" />
            <path class="edge" d="M477.9,705.8v-219.6l34.6-13.8" />
            <g class="dot">
              <path d="M325.5,566.8c0,2.2-1.2,2.8-2.7,1.4s-2.7-4.3-2.7-6.5,1.2-2.8,2.7-1.4,2.7,4.3,2.7,6.5Z" />
              <path d="M331.3,587.1c0,2.2-1.2,2.8-2.7,1.4s-2.7-4.3-2.7-6.5,1.2-2.8,2.7-1.4,2.7,4.3,2.7,6.5Z" />
              <path d="M319.6,576.1c0,2.2-1.2,2.8-2.7,1.4s-2.7-4.3-2.7-6.5,1.2-2.8,2.7-1.4,2.7,4.3,2.7,6.5Z" />
            </g>
            <path
              class="guide"
              d="M436.5,618.3l12.5,11.8v68l-92.8-88h0s-.5-121.5-.5-121.5l-61.3-58.1v121h0s-92.4-87.6-92.4-87.6"
            />
            <path
              class="vent"
              d="M427.9,624.2c-1.4-.3-3-1.3-4.7-2.9-5.9-5.6-10.7-17.1-10.7-25.6s.2-3,.5-4.1"
            />
            <path
              class="arc"
              d="M414.4,588.7c1.9-2.3,5.2-1.9,8.9,1.6,5.9,5.6,10.7,17.1,10.7,25.6,0,4.3-1.2,7-3.1,8"
            />
            <polygon
              class="shade"
              points="187.7 280.9 187.7 461.9 457.9 718 457.9 477.7 243.1 274.8 242.7 332.9 187.7 280.9"
            />
          </g>
          <g id="front_card">
            <path
              class="card-front"
              d="M167.8,699.5l8.4-1.1h3.9c0,.1,6.9,1.2,6.9,1.2l3.1.8,7.2,2.9,6.8-2.7,4.4-2.2,2.4-6.8v-239.6l-95.9-90.9-6.7-3.6-53.7,21.5-4.4,2.2-2.4,6.8v116.4l1.6,1.9-1.6,4.7v116.5l46.2,43.8,3.4,1.9v1.4l46.3,43.9,6.7,3.6,4.5-1.8,3.1-1.7.8-6.2,1.9-7,1.7-3.8"
            />
            <path
              class="edge"
              d="M162.4,701.7l1.5-3.5,4.1-6.1,2.4-3.3,4.9-4.1,1.8-1.5,6.7-2.7,6.7.3,6.3,4,.4.5,2.9,4.5,1.9,5.5.8,5.5"
            />
            <path class="card-front" d="M162.3,701.7l5.4-2.2" />
            <path class="guide" d="M153.7,468.6l-3.4,1.3-93.5-88.7" />
            <path class="guide" d="M156.1,410.4l42.5,40.3,4.4,10.4v69.6" />
            <path class="guide" d="M52.7,510.1l43.4,41.2,1.3,3.6v114.1" />
            <path
              class="edge"
              d="M163.9,698.2l2.1-1,1.8-1.1,2-1.7,1.4-1.6,1.6-2.3,1.3-2.3,1.3-3.5"
            />
            <path
              class="edge"
              d="M171.1,692.7l2.6.2,3.6-.4,2.4-.7,3.2-1.6,2.8-2.3,1.7-2,1.3-1.9,1.7-3.4"
            />
            <path class="guide" d="M154.2,413.7v11.7" />
            <path
              class="guide"
              d="M115.4,424.1l9.5-3.8.8-.3,15.3-6.1.8-.3,9.3-3.7"
            />
            <path class="edge" d="M160.8,552v-74l-4.4-10.4-37.8-35.8-6.6-6.3" />
            <path class="guide" d="M199.9,536.3l-35.3,14.1" />
            <path class="guide" d="M191.2,523.9l8.7,8.3" />
            <path
              class="hairline"
              d="M133,427.2c1.2-3.5,4.3-6.9,8-8.4s5.5-.8,7,.7l.6.6,18.5,17.5s22,20.6,24.2,57.8v37.7c0,2.1-1.7,3.9-4.8,5.1s-8,1.3-11.3,0"
            />
            <path
              class="hairline"
              d="M118.5,431.6c1.6-2.6,4-4.8,6.8-5.9s5.5-.8,7,.7h0s19.7,18.7,19.7,18.7c0,0,19.2,18.7,23,56.8v37.4h0c0,2-1.7,4-4.7,5.2-3,1.2-6.5,1.3-9.5.5"
            />
            <path
              class="vent"
              d="M129.6,559.3c-.6-.5-1.3-1-1.9-1.6-8-7.6-14.6-23.2-14.6-34.9h0v-48l.3-3.9.3-1.7.5-1.5.8-1.5"
            />
            <path
              class="hairline"
              d="M135.8,553.7c0,11.6-6.5,14.9-14.6,7.3-8-7.6-14.6-23.2-14.6-34.9v-50.7c0-11.7,6.6-14.9,14.7-7.3s14.5,23.3,14.5,34.9v50.7h0Z"
            />
            <line class="vent" x1="56.8" y1="454.9" x2="56.8" y2="498.9" />
            <line class="vent" x1="61.7" y1="459.2" x2="61.7" y2="503.6" />
            {/* The front card's single LED — same treatment as the back
                card's three (ring arcs, inset dot, halo, spark). */}
            <g class="led">
              <circle class="led-halo" />
              <path
                class="arc"
                d="M175.6,574.4c-1.8-1-2.9-2.8-2.9-5.4,0-5.1,4.4-11,9.9-13.2s5.2-1,7,0"
              />
              <path
                class="vent"
                d="M191.5,557.6c.6,1,1,2.2,1,3.6,0,5.1-4.4,11-9.9,13.2s-3.3.9-4.6.8"
              />
              <path
                class="dot led-inset"
                d="M184.8,560.4c0,2.6-2.2,5.6-5,6.7s-5-.1-5-2.7,2.2-5.6,5-6.7,5,.1,5,2.7Z"
              />
              <circle class="led-spark" />
            </g>
            <g class="dot">
              <path d="M72.7,624.6c0,2.2-1.2,2.8-2.7,1.4s-2.7-4.3-2.7-6.5,1.2-2.8,2.7-1.4,2.7,4.3,2.7,6.5Z" />
              <path d="M78.5,644.9c0,2.2-1.2,2.8-2.7,1.4s-2.7-4.3-2.7-6.5,1.2-2.8,2.7-1.4,2.7,4.3,2.7,6.5Z" />
              <path d="M66.9,633.8c0,2.2-1.2,2.8-2.7,1.4s-2.7-4.3-2.7-6.5,1.2-2.8,2.7-1.4,2.7,4.3,2.7,6.5Z" />
            </g>
            <polyline
              class="shade"
              points="47.8 388.1 47.8 627.6 143.7 718.5 143.7 480.4"
            />
          </g>
          {/* Invisible geometry reference: the Macro logo at the exact spot
              the designer superimposed it over these blocks (authored in the
              source artwork with no transform, so its coords are in the same
              space as the card paths above — hence its place here, inside
              `.blocks`). Never painted; it exists so a brand handoff can
              measure where the real logo belongs via
              `getBoundingClientRect()` and let the browser resolve the
              viewBox + transform math, instead of hardcoding pixel offsets
              that would drift with the scene's size. */}
          <g class="logo-ref" aria-hidden="true">
            <path d="M47.8,389.1v224.9c.2,6.4,2.9,12.5,7.4,17l90.7,87.4,66.2-26.5v-234.7l-98.2-94.5-66.1,26.5Z" />
            <path d="M182.7,216.7v191.3l45,43.3v43.4l232.9,224.6,66.2-26.5v-234.8S248.8,190.2,248.8,190.2l-66.1,26.5Z" />
            <path d="M497.3,216.7v191.3l45,43.4-.4,43,233.4,225,66.1-26.5v-224.2c0-6.6-2.7-13-7.4-17.6l-270.5-260.8-66.2,26.5Z" />
          </g>
        </g>
        {/* Tethers to front features draw over the cards. */}
        <g class="connectors">
          <For each={connectorsIn('front')}>
            {(connector) => (
              <>
                <path class="connector" d={connector.d} />
                <Show when={connector.downloading}>
                  <DownloadPulse d={connector.d} />
                </Show>
              </>
            )}
          </For>
        </g>
        {/* Modules: the configured slots, phase-offset so they don't bob in
            unison. */}
        <g class="modules">
          <For each={modules()}>
            {(module, index) => (
              <Module
                place={SLOTS[module.slot].place}
                logo={module.logo}
                state={module.state}
                phaseMs={-index() * MOTION.modulePhaseMs}
              />
            )}
          </For>
        </g>
      </g>
    </svg>
  );
}
