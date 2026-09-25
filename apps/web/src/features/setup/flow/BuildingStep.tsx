import { createSignal, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ModuleLogo } from '../Module';
import { MODULE_LOGOS } from '../moduleLogos';
import { type ModuleConfig, SetupGraphic } from '../SetupGraphic';
import { type BrandHandoffSource, logoBoxForMark } from './BrandHandoff';

/** Which tools the user connected during the flow — decides which modules
 *  appear in the loading scene. */
export type ConnectedTools = {
  google: boolean;
  linear: boolean;
  notion: boolean;
  slack: boolean;
  github: boolean;
};

/** The theatrical hold scales with how many accounts connected: a quick 5s
 *  when there's nothing to show, up to the full 15s once more than two are
 *  connected. The rest of the timeline compresses to fit. */
const MIN_HOLD_MS = 5_000;
const MAX_HOLD_MS = 15_000;

/** A scripted, purely-theatrical fill for the progress bar: bursts of varying
 *  speed with a couple of stalls between them (including a long one near the
 *  end before the finish). `fill` eases the bar to `to`% over that many ms; a
 *  `pause` just holds. Offsets accumulate and land ~100% just before the hold
 *  ends. */
type BarSegment = { to: number; fill: number } | { pause: number };
const BAR_TIMELINE: BarSegment[] = [
  { to: 22, fill: 900 }, // initial climb
  { pause: 1600 },
  { to: 40, fill: 650 }, // quick surge
  { pause: 2800 }, // stall
  { to: 68, fill: 1100 },
  { pause: 1900 },
  { to: 86, fill: 550 }, // quick surge
  { pause: 3000 }, // long stall right before the finish
  { to: 100, fill: 1600 }, // final climb
];
/** A short beat before the first burst — also lets the 0% paint before the
 *  first width change so its transition triggers (no mount-frame jump). */
const BAR_START_DELAY_MS = 200;
/** Easing per burst: fast off the mark, easing into each hold. */
const BAR_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Slots the connected accounts fill, in populate order. */
const SLOT_ORDER = [
  'frontPill',
  'midBack',
  'backFar',
  'midFar',
  'midPort',
] as const;

/** Tools in the order they're assigned to {@link SLOT_ORDER}, each with its
 *  module logo. Filtered to the ones the user connected. */
const TOOL_LOGOS: { key: keyof ConnectedTools; logo: ModuleLogo }[] = [
  { key: 'google', logo: MODULE_LOGOS.Google },
  { key: 'linear', logo: MODULE_LOGOS.Linear },
  { key: 'notion', logo: MODULE_LOGOS.Notion },
  { key: 'slack', logo: MODULE_LOGOS.Slack },
  { key: 'github', logo: MODULE_LOGOS.GitHub },
];

/** A beat of all-idle before the first module starts downloading. */
const MODULE_IDLE_LEAD_MS = 700;
/** After the last module links, a short buffer before powering up. */
const POST_LINK_BUFFER_MS = 300;
/** Hold on the fully powered graphic before handing off. The graphic → logo
 *  dissolve runs during the handoff's travel (see BrandHandoff), so the
 *  motion covers the geometry mismatch between the isometric mark and the
 *  flat logo. */
const POWERED_HOLD_MS = 700;
/** Total time reserved after the last module links: buffer + hold. `onDone`
 *  fires once this has played out. */
const POWERED_TAIL_MS = POST_LINK_BUFFER_MS + POWERED_HOLD_MS;

export function BuildingStep(props: {
  connected: ConnectedTools;
  onDone: (source: BrandHandoffSource | null) => void;
}) {
  // Bar fill % and the transition duration for the current burst — set
  // together per segment so each burst eases over its own `fill` time.
  const [progress, setProgress] = createSignal(0);
  const [burstMs, setBurstMs] = createSignal(0);

  // The scene's modules: one per connected account, filling SLOT_ORDER. A
  // store (not a fresh array per change) so toggling a module's state updates
  // it in place — the For in SetupGraphic keeps each Module mounted, so its
  // ambient motion doesn't restart. Empty when nothing was connected: the
  // three cards still render on their own.
  const [modules, setModules] = createStore<ModuleConfig[]>(
    TOOL_LOGOS.filter((tool) => props.connected[tool.key]).map((tool, i) => ({
      slot: SLOT_ORDER[i],
      logo: tool.logo,
      state: 'idle',
    }))
  );
  const [poweredUp, setPoweredUp] = createSignal(false);

  // This holds the rendered SVG, not the outer scene wrapper: its viewport
  // rect and serialized markup are exactly what the portal overlay needs to
  // continue the scene without a visual jump.
  let sceneEl: HTMLDivElement | undefined;

  onMount(() => {
    // The hold scales 5s → 15s with the connected count (maxing out past two
    // accounts); the whole theatrical timeline compresses by `scale` to fit.
    const n = modules.length;
    const holdMs =
      MIN_HOLD_MS + (MAX_HOLD_MS - MIN_HOLD_MS) * (Math.min(n, 3) / 3);
    const scale = holdMs / MAX_HOLD_MS;

    // Cycle each module idle → downloading → linked, evenly spaced across the
    // hold and reserving a tail for the powered-up finale. Each module
    // downloads for its whole slice, then flips to linked as the next begins.
    const moduleTimers: ReturnType<typeof setTimeout>[] = [];
    const idleLead = MODULE_IDLE_LEAD_MS * scale;
    const tail = POWERED_TAIL_MS * scale;
    if (n > 0) {
      const window = holdMs - idleLead - tail;
      const slice = window / n;
      for (let i = 0; i < n; i++) {
        moduleTimers.push(
          setTimeout(
            () => setModules(i, 'state', 'downloading'),
            idleLead + i * slice
          )
        );
        moduleTimers.push(
          setTimeout(
            () => setModules(i, 'state', 'linked'),
            idleLead + (i + 1) * slice
          )
        );
      }
    }
    // Power up once everything's linked (or, with nothing connected, just
    // before the end). Modules are cleared in the same tick: SetupGraphic
    // fades `.modules` out over 700ms on `.powered`, and since they're
    // already `linked` (steady accent) by now, that lingering fade reads as
    // a stray offset logo hanging next to the cards as they fill in.
    // Clearing the array unmounts them outright — no separate exit
    // transition is wired up for the `<For>` — so power-up is a clean cut
    // straight to the cards.
    const powerAt = holdMs - tail + (n > 0 ? POST_LINK_BUFFER_MS * scale : 0);
    const powerTimer = setTimeout(() => {
      setModules([]);
      setPoweredUp(true);
    }, powerAt);

    // Capture the powered SVG after a beat, then let the parent mount a
    // portal overlay which moves this exact scene while dissolving it into the
    // flat Macro logo. Capturing rather than re-rendering avoids a one-frame
    // reset of the SVG's CSS/WAAPI state at the handoff boundary.
    const handoffAt = powerAt + POWERED_HOLD_MS * scale;
    const handoffTimer = setTimeout(() => {
      const graphic = sceneEl?.querySelector<SVGSVGElement>('.setup-graphic');
      const scene = graphic?.getBoundingClientRect();
      const mark = graphic?.querySelector('.logo-ref')?.getBoundingClientRect();
      if (!graphic || !scene || !mark) {
        props.onDone(null);
        return;
      }
      props.onDone({
        scene: {
          x: scene.x,
          y: scene.y,
          width: scene.width,
          height: scene.height,
        },
        // This is relative to the SVG's box because the portal frame starts
        // at that same box. `logoBoxForMark` accounts for the SVG icon's
        // vertical viewBox padding, so the *painted* logo aligns to the mark.
        logo: logoBoxForMark({
          x: mark.x - scene.x,
          y: mark.y - scene.y,
          width: mark.width,
          height: mark.height,
        }),
        snapshot: graphic.outerHTML,
      });
    }, handoffAt);

    // Progress bar: the same scripted bursts/stalls, compressed by `scale`.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let offset = BAR_START_DELAY_MS * scale;
    for (const segment of BAR_TIMELINE) {
      if ('pause' in segment) {
        offset += segment.pause * scale;
        continue;
      }
      const { to, fill } = segment;
      const dur = fill * scale;
      timers.push(
        setTimeout(() => {
          setBurstMs(dur);
          setProgress(to);
        }, offset)
      );
      offset += dur;
    }

    onCleanup(() => {
      for (const timer of timers) clearTimeout(timer);
      for (const timer of moduleTimers) clearTimeout(timer);
      clearTimeout(powerTimer);
      clearTimeout(handoffTimer);
    });
  });

  return (
    <div class="flex flex-col items-center gap-8 py-16">
      {/* The isometric scene: three cards always present, with connected
          accounts cycling in before resolving into the powered Macro mark.
          Its exact final SVG is captured and carried by the parent handoff. */}
      <div ref={sceneEl} class="relative h-[28rem] w-full">
        <div class="absolute inset-0">
          <SetupGraphic
            class="size-full"
            modules={modules}
            poweredUp={poweredUp()}
          />
        </div>
      </div>

      <div class="h-1 w-48 overflow-hidden rounded-full bg-ink/10">
        <div
          class="h-full rounded-full bg-accent"
          style={{
            width: `${progress()}%`,
            transition: `width ${burstMs()}ms ${BAR_EASING}`,
          }}
        />
      </div>
    </div>
  );
}
