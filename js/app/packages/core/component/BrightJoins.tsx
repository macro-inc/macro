import type { JSX } from 'solid-js';

export function BrightJoins(props: {
  dots?: [boolean, boolean, boolean, boolean];
}): JSX.Element {
  const [tl, tr, br, bl] = props.dots ?? [true, true, true, true];
  const layers: string[] = [];
  const positions: string[] = [];
  if (tl) {
    layers.push('linear-gradient(currentColor, currentColor)');
    positions.push('top left');
  }
  if (tr) {
    layers.push('linear-gradient(currentColor, currentColor)');
    positions.push('top right');
  }
  if (br) {
    layers.push('linear-gradient(currentColor, currentColor)');
    positions.push('bottom right');
  }
  if (bl) {
    layers.push('linear-gradient(currentColor, currentColor)');
    positions.push('bottom left');
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: '-1px',
        'z-index': 200,
        'pointer-events': 'none',
        'background-image': layers.join(', '),
        'background-position': positions.join(', '),
        'background-repeat': 'no-repeat',
        'background-size': '1px 1px',
      }}
    />
  );
}
