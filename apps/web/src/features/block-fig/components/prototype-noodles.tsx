/**
 * Prototype connections drawn over the canvas while the Prototype tab is
 * open, as Figma draws its "noodles": a curve from each hotspot to the
 * frame it goes to (the selection's in the accent color; all of them
 * when nothing with connections is selected), and a tag on each flow's
 * starting frame.
 */

import type { PrototypeInfo } from '@core/fig-engine/prototype-types';
import { createMemo, For } from 'solid-js';
import { type Camera, pageToScreen } from '../core/camera';
import { flowsOf } from '../core/prototype';

interface Noodle {
  from: string;
  to: string;
  path: string;
  /** Arrowhead at the end. */
  head: string;
  selected: boolean;
}

export function PrototypeNoodles(props: {
  info: PrototypeInfo;
  camera: Camera;
  selected: readonly string[];
}) {
  const frames = createMemo(
    () => new Map(props.info.frames.map((f) => [f.id, f]))
  );
  const noodles = createMemo((): Noodle[] => {
    const selected = new Set(props.selected);
    const anySelected = props.info.hotspots.some((h) => selected.has(h.id));
    const out: Noodle[] = [];
    for (const h of props.info.hotspots) {
      const mine = selected.has(h.id);
      if (anySelected && !mine) continue;
      for (const i of h.interactions)
        for (const a of i.actions) {
          if (a.connection !== 'INTERNAL_NODE' || !a.destination) continue;
          if (a.navigation === 'SWAP_STATE' || a.navigation === 'SCROLL_TO')
            continue;
          const dest = frames().get(a.destination);
          if (!dest) continue;
          const s = pageToScreen(props.camera, {
            x: h.bounds.x + h.bounds.w,
            y: h.bounds.y + h.bounds.h / 2,
          });
          // Into the destination's nearer side.
          const left = dest.bounds.x >= h.bounds.x + h.bounds.w / 2;
          const e = pageToScreen(props.camera, {
            x: left ? dest.bounds.x : dest.bounds.x + dest.bounds.w,
            y: dest.bounds.y + Math.min(40, dest.bounds.h / 2),
          });
          const pull = Math.max(40, Math.abs(e.x - s.x) / 2);
          const c1x = s.x + pull;
          const c2x = left ? e.x - pull : e.x + pull;
          const dir = left ? 1 : -1;
          out.push({
            from: h.id,
            to: dest.id,
            path: `M${s.x},${s.y} C${c1x},${s.y} ${c2x},${e.y} ${e.x},${e.y}`,
            head: `M${e.x - 7 * dir},${e.y - 4} L${e.x},${e.y} L${e.x - 7 * dir},${e.y + 4} Z`,
            selected: mine,
          });
        }
    }
    return out;
  });
  const flowTags = () =>
    flowsOf(props.info).flatMap((flow) => {
      const f = frames().get(flow.frame);
      if (!f) return [];
      return [
        {
          flow,
          at: pageToScreen(props.camera, { x: f.bounds.x, y: f.bounds.y }),
        },
      ];
    });

  return (
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <svg class="absolute inset-0 size-full" aria-hidden="true">
        <For each={noodles()}>
          {(n) => (
            <g
              class={n.selected ? 'text-accent' : 'text-accent/50'}
              data-testid="fig-noodle"
              data-from={n.from}
              data-to={n.to}
            >
              <path
                d={n.path}
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              />
              <path d={n.head} fill="currentColor" />
            </g>
          )}
        </For>
      </svg>
      <For each={flowTags()}>
        {(t) => (
          <span
            class="absolute rounded-sm bg-accent px-1.5 py-0.5 font-medium text-[10px] text-accent-contrast"
            style={{
              left: `${t.at.x}px`,
              top: `${t.at.y - 40}px`,
            }}
            data-testid="fig-flow-badge"
          >
            ▶ {t.flow.name}
          </span>
        )}
      </For>
    </div>
  );
}
