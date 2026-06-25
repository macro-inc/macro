import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useHistory } from './HistoryContext';

function seededRng(seed: number) {
  let s = seed >>> 0;
  return (min: number, max: number) => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return min + (s / 0x100000000) * (max - min);
  };
}

interface Scratch {
  top: number;
  left: number;
  w: number;
  rot: number;
  op: number;
  h: number;
}

const SCRATCHES: Scratch[] = (() => {
  const rand = seededRng(0xcafe1234);
  const out: Scratch[] = [];
  // Long diagonal sweeps across the pane
  for (let i = 0; i < 18; i++)
    out.push({
      top: rand(2, 96),
      left: rand(-15, 10),
      w: rand(200, 750),
      rot: rand(-13, -3),
      op: rand(0.03, 0.085),
      h: 1,
    });
  // Medium cross-hatched scratches
  for (let i = 0; i < 50; i++)
    out.push({
      top: rand(2, 96),
      left: rand(0, 88),
      w: rand(30, 180),
      rot: rand(-90, 90),
      op: rand(0.05, 0.2),
      h: 1,
    });
  // Short chips and flicks
  for (let i = 0; i < 80; i++)
    out.push({
      top: rand(2, 96),
      left: rand(0, 90),
      w: rand(5, 45),
      rot: rand(-90, 90),
      op: rand(0.08, 0.26),
      h: 1,
    });
  // Micro cuts — very short, high opacity, like deep glass incisions
  for (let i = 0; i < 120; i++)
    out.push({
      top: rand(2, 96),
      left: rand(5, 90),
      w: rand(2, 11),
      rot: rand(-90, 90),
      op: rand(0.2, 0.38),
      h: 1,
    });
  // Heavy 2px grooves
  for (let i = 0; i < 10; i++)
    out.push({
      top: rand(5, 88),
      left: rand(-5, 50),
      w: rand(80, 320),
      rot: rand(-15, 5),
      op: rand(0.04, 0.1),
      h: 2,
    });
  // Parallel double-scratch pairs (dragged object leaves two parallel marks)
  for (let i = 0; i < 16; i++) {
    const t = rand(5, 88),
      l = rand(5, 70),
      w = rand(50, 200),
      rot = rand(-40, 40),
      op = rand(0.07, 0.16);
    out.push({ top: t, left: l, w, rot, op, h: 1 });
    out.push({
      top: t + rand(0.3, 0.8),
      left: l + rand(0.2, 0.5),
      w: w * rand(0.65, 0.95),
      rot: rot + rand(-2, 2),
      op: op * rand(0.4, 0.7),
      h: 1,
    });
  }
  return out;
})();

interface ImpactLine {
  rot: number;
  len: number;
  op: number;
}

interface Impact {
  top: number;
  left: number;
  lines: ImpactLine[];
}

// Impact starburst points — hard pebble hits that radiate fracture lines
const IMPACTS: Impact[] = (() => {
  const rand = seededRng(0xbeef4567);
  const centers = [
    { top: 19, left: 71 },
    { top: 54, left: 24 },
    { top: 76, left: 68 },
    { top: 9, left: 38 },
    { top: 43, left: 55 },
    { top: 32, left: 84 },
    { top: 66, left: 14 },
  ];
  return centers.map((c) => ({
    ...c,
    lines: Array.from({ length: Math.floor(rand(9, 18)) }, () => ({
      rot: rand(0, 360),
      len: rand(4, 34),
      op: rand(0.1, 0.28),
    })),
  }));
})();

const SHIMMER_CSS = `
@keyframes glass-shimmer {
  0%, 100% { opacity: 1; }
  42% { opacity: 0.68; }
  58% { opacity: 0.85; }
}
@keyframes glass-shimmer-2 {
  0%, 100% { opacity: 0.85; }
  35% { opacity: 1; }
  65% { opacity: 0.72; }
}
`;

export function OldOverlay() {
  const history = useHistory();
  const splitPanel = useSplitPanel();
  const oldOverlayMount = () => splitPanel?.layoutRefs.overlay;

  return (
    <Show when={history.isViewingHistory() && oldOverlayMount()}>
      <Portal mount={oldOverlayMount()!}>
        <div
          class="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ 'backdrop-filter': 'saturate(1.06) brightness(1.01)' }}
        >
          <style>{SHIMMER_CSS}</style>

          {/* Base tint */}
          <div class="absolute inset-0 bg-gradient-to-b from-ink/[0.028] via-transparent to-ink/[0.018]" />

          {/* Fine dot grain */}
          <div
            class="absolute inset-0 text-ink opacity-[0.055]"
            style={{
              'background-image':
                'radial-gradient(currentColor 0.45px, transparent 0.6px)',
              'background-size': '4px 4px',
            }}
          />

          {/* === GLASS GLARE BANDS === */}
          {/* Primary wide glare sweep */}
          <div
            class="absolute inset-y-[-10%] left-[-30%] w-[55%] rotate-[13deg]"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.026) 38%, rgba(255,255,255,0.044) 50%, rgba(255,255,255,0.026) 62%, transparent 100%)',
              animation: 'glass-shimmer 9s ease-in-out infinite',
            }}
          />
          {/* Secondary narrower glare — second surface of the glass */}
          <div
            class="absolute inset-y-[-10%] right-[8%] w-[20%] rotate-[13deg]"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.014) 45%, rgba(255,255,255,0.022) 55%, transparent 100%)',
              animation: 'glass-shimmer-2 9s ease-in-out infinite 2s',
            }}
          />
          {/* Thin bright glare edge at top — glass plane catches ambient light */}
          <div class="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/[0.24] to-white/[0.07]" />
          <div class="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-ink/[0.045] via-ink/[0.014] to-transparent" />

          {/* Chromatic fringe on the top edge — glass refracts light */}
          <div class="absolute inset-x-0 top-[1.5px] h-px bg-gradient-to-r from-transparent via-blue-400/[0.045] to-transparent" />
          <div class="absolute inset-x-[8%] top-[2.5px] h-px w-[84%] bg-gradient-to-r from-transparent via-red-300/[0.03] to-transparent" />

          {/* Corner bloom */}
          <div class="absolute top-0 left-0 h-20 w-36 bg-gradient-to-br from-white/[0.05] to-transparent" />
          <div class="absolute bottom-0 right-0 h-14 w-28 bg-gradient-to-tl from-white/[0.03] to-transparent" />
          <div class="absolute top-0 right-0 h-24 w-48 bg-gradient-to-bl from-ink/[0.08] via-ink/[0.018] to-transparent" />

          {/* Light column volumes */}
          <div class="absolute -top-32 right-[12%] h-[38rem] w-28 rotate-12 rounded-full bg-gradient-to-b from-ink/[0.09] via-ink/[0.018] to-transparent blur-sm" />
          <div class="absolute top-8 right-[32%] h-96 w-9 rotate-12 rounded-full bg-gradient-to-b from-ink/[0.06] via-ink/[0.014] to-transparent blur-[1px]" />
          <div class="absolute bottom-[-20%] left-[10%] h-80 w-16 -rotate-12 rounded-full bg-gradient-to-t from-ink/[0.045] via-ink/[0.01] to-transparent blur-md" />

          {/* Fingerprint / smudge blobs */}
          <div
            class="absolute top-[28%] left-[58%] h-14 w-20 opacity-[0.022]"
            style={{
              background:
                'radial-gradient(ellipse 100% 60% at 50% 50%, currentColor 0%, transparent 100%)',
              filter: 'blur(2px)',
              transform: 'rotate(-8deg)',
              color: 'var(--color-ink, #000)',
            }}
          />
          <div
            class="absolute top-[54%] left-[22%] h-10 w-16 opacity-[0.025]"
            style={{
              background:
                'radial-gradient(ellipse 100% 55% at 50% 50%, currentColor 0%, transparent 100%)',
              filter: 'blur(1.5px)',
              transform: 'rotate(5deg)',
              color: 'var(--color-ink, #000)',
            }}
          />
          <div
            class="absolute bottom-[18%] right-[22%] h-9 w-14 opacity-[0.019]"
            style={{
              background:
                'radial-gradient(ellipse 100% 50% at 50% 50%, currentColor 0%, transparent 100%)',
              filter: 'blur(2px)',
              transform: 'rotate(-12deg)',
              color: 'var(--color-ink, #000)',
            }}
          />

          {/* === GENERATED SCRATCHES === */}
          <div class="text-ink">
            <For each={SCRATCHES}>
              {(s) => (
                <div
                  style={{
                    position: 'absolute',
                    top: `${s.top}%`,
                    left: `${s.left}%`,
                    width: `${s.w}px`,
                    height: `${s.h}px`,
                    transform: `rotate(${s.rot}deg)`,
                    'transform-origin': 'left center',
                    opacity: s.op,
                    background:
                      'linear-gradient(90deg, transparent, currentColor, transparent)',
                  }}
                />
              )}
            </For>
          </div>

          {/* === IMPACT STARBURSTS === */}
          <div class="text-ink">
            <For each={IMPACTS}>
              {(impact) => (
                <div
                  style={{
                    position: 'absolute',
                    top: `${impact.top}%`,
                    left: `${impact.left}%`,
                    width: '0',
                    height: '0',
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <For each={impact.lines}>
                    {(line) => (
                      <div
                        style={{
                          position: 'absolute',
                          top: '0',
                          left: `${-line.len / 2}px`,
                          width: `${line.len}px`,
                          height: '1px',
                          transform: `rotate(${line.rot}deg)`,
                          'transform-origin': 'center',
                          opacity: line.op,
                          background:
                            'linear-gradient(90deg, transparent, currentColor, transparent)',
                        }}
                      />
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>

          <div class="absolute bottom-4 right-5 select-none text-sm tracking-wide text-ink/40">
            You are viewing a historical state
          </div>
        </div>
      </Portal>
    </Show>
  );
}
