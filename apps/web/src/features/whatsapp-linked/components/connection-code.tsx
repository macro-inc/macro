import { createMemo } from 'solid-js';
import { encode } from 'uqr';

/**
 * The pairing QR, encoded here: the value never reaches an image URL or a
 * third party. Black on white in both themes so phones can read it.
 */
export function ConnectionCode(props: { value: string; label: string }) {
  const code = createMemo(() => encode(props.value, { ecc: 'M', border: 2 }));
  const path = () =>
    code()
      .data.flatMap((row, y) =>
        row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))
      )
      .join('');
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`0 0 ${code().size} ${code().size}`}
      shape-rendering="crispEdges"
      class="size-56 rounded-xl border border-edge-muted"
    >
      <rect width="100%" height="100%" fill="#fff" />
      <path d={path()} fill="#000" />
    </svg>
  );
}
