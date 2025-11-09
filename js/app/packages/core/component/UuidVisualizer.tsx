// Uuid7Viz.tsx
type Mode = 'grid' | 'barcode';

export function Uuid7Viz({
  uuid,
  mode = 'grid',
  cell = 2,
  gap = 0,
}: {
  uuid: string;
  mode?: Mode;
  cell?: number;
  gap?: number;
}) {
  // 128 bits = 32 hex chars; remove dashes, clamp to 32
  const hex = uuid.replace(/-/g, '').toLowerCase().slice(0, 32);

  // expand hex -> bits (MSB first per nibble)
  const bits: number[] = [];
  for (let i = 0; i < hex.length; i++) {
    const n = parseInt(hex[i], 16);
    bits.push((n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1);
  }

  if (mode === 'barcode') {
    const cols = bits.length; // 128
    const w = cols * cell + (cols - 1) * gap;
    const h = 8 * cell;
    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        shape-rendering="crispEdges"
      >
        <g fill="currentColor">
          {
            // biome-ignore lint/performance/useSolidForComponent: Exceptions
            bits.map((b, i) =>
              b ? (
                <rect x={i * (cell + gap)} y={0} width={cell} height={h} />
              ) : null
            )
          }
        </g>
      </svg>
    );
  }

  // grid: 16x8 = 128 cells
  const cols = 16,
    rows = 8;
  const w = cols * cell + (cols - 1) * gap;
  const h = rows * cell + (rows - 1) * gap;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      shape-rendering="crispEdges"
    >
      <g fill="currentColor">
        {
          // biome-ignore lint/performance/useSolidForComponent: Exceptions
          bits
            .slice(0, cols * rows)
            .map((b, i) =>
              b ? (
                <rect
                  x={(i % cols) * (cell + gap)}
                  y={Math.floor(i / cols) * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={cell / 2}
                  ry={cell / 2}
                />
              ) : null
            )
        }
      </g>
    </svg>
  );
}
