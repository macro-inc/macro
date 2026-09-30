import { For } from 'solid-js';
import { MACRO_MARK_PATHS } from './MacroMarkIcon';

const CX = 120;
const CY = 120;
const RING_R = 92;
const RING_PATH = `M ${CX},${CY} m 0,-${RING_R} a ${RING_R},${RING_R} 0 1,1 0,${RING_R * 2} a ${RING_R},${RING_R} 0 1,1 0,-${RING_R * 2}`;
const RING_LEN = +(2 * Math.PI * RING_R).toFixed(2);

const ticks = Array.from({ length: 48 }, (_, i) => {
  const rad = ((i / 48) * 360 - 90) * (Math.PI / 180);
  const major = i % 4 === 0;
  const r1 = major ? 108 : 110.5;
  const r2 = 116;
  return {
    x1: +(CX + Math.cos(rad) * r1).toFixed(2),
    y1: +(CY + Math.sin(rad) * r1).toFixed(2),
    x2: +(CX + Math.cos(rad) * r2).toFixed(2),
    y2: +(CY + Math.sin(rad) * r2).toFixed(2),
    major,
  };
});

/** Circular seal: Macro mark, chapter ticks, and a legend around the rim. */
export function PartnerBadge() {
  return (
    <svg
      viewBox="0 0 240 240"
      role="img"
      aria-labelledby="partner-badge-title"
      style={{
        display: 'block',
        height: 'auto',
        overflow: 'visible',
        width: '100%',
      }}
    >
      <title id="partner-badge-title">Macro Approved Partner badge</title>
      <defs>
        <path id="partner-badge-ring" d={RING_PATH} />
        <radialGradient id="partner-badge-disc" cx="46%" cy="38%" r="68%">
          <stop offset="0%" stop-color="var(--b2)" />
          <stop offset="100%" stop-color="var(--b1)" />
        </radialGradient>
      </defs>

      <circle
        cx={CX}
        cy={CY}
        r="118.5"
        fill="none"
        stroke="color-mix(in srgb, var(--a0) 28%, transparent)"
        stroke-width="1"
      />
      <circle
        cx={CX}
        cy={CY}
        r="116"
        fill="none"
        stroke="var(--a0)"
        stroke-width="1.35"
      />

      <For each={ticks}>
        {(tick) => (
          <line
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke="var(--a0)"
            stroke-linecap="round"
            stroke-width={tick.major ? 1.35 : 0.85}
            opacity={tick.major ? 0.95 : 0.4}
          />
        )}
      </For>

      <circle
        cx={CX}
        cy={CY}
        r="104"
        fill="none"
        stroke="color-mix(in srgb, var(--a0) 35%, transparent)"
        stroke-width="0.9"
      />

      <text
        fill="var(--c1)"
        font-family="rajdhani, body, sans-serif"
        font-size="9.2"
        font-weight="700"
        letter-spacing="2.4"
        textLength={RING_LEN}
        lengthAdjust="spacing"
      >
        <textPath href="#partner-badge-ring" startOffset="0">
          APPROVED PARTNER · MACRO · APPROVED PARTNER · MACRO ·
        </textPath>
      </text>

      <circle
        cx={CX}
        cy={CY}
        r="70"
        fill="url(#partner-badge-disc)"
        stroke="var(--a0)"
        stroke-width="1.5"
      />
      <circle
        cx={CX}
        cy={CY}
        r="64"
        fill="none"
        stroke="color-mix(in srgb, var(--a0) 32%, transparent)"
        stroke-width="0.8"
      />

      <g
        transform="translate(120, 112) scale(0.46) translate(-91, -59.5)"
        fill="var(--a0)"
      >
        <path d={MACRO_MARK_PATHS[0]} />
        <path d={MACRO_MARK_PATHS[1]} />
        <path d={MACRO_MARK_PATHS[2]} />
      </g>
    </svg>
  );
}
