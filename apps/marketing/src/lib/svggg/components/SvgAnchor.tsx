import { createMemo } from 'solid-js';
import { useParentMatrix } from '../utils/svgContext';
import { transformPoint3D } from '../utils/svgMatrix';

interface SvgAnchorProps {
  id?: string;
  z?: number;
  x: number;
  y: number;
}

export function SvgAnchor(props: SvgAnchorProps) {
  const getParentMatrix = useParentMatrix();

  const pos = createMemo(() => {
    return transformPoint3D(
      { x: props.x, y: props.y, z: props.z ?? 0 },
      getParentMatrix()
    );
  });

  return (
    <circle
      stroke="none"
      id={props.id}
      cx={pos().x}
      cy={pos().y}
      fill="none"
      r={0.001}
    />
  );
}
