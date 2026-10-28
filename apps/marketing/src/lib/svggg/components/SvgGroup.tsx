import { createMemo, type JSX, type ParentProps } from 'solid-js';
import type { Mat4, Vec3 } from '../types/svgTypes';
import {
  ParentMatrixContext,
  useParentMatrix,
  useViewBox,
} from '../utils/svgContext';
import { multiply, transformToMatrix } from '../utils/svgMatrix';
import { buildLocalTransform, getViewBoxCenter } from '../utils/svgUtils';

interface SvgGroupProps {
  onClick?: JSX.EventHandlerUnion<SVGGElement, MouseEvent>;
  translation?: Partial<Vec3>;
  style?: JSX.CSSProperties;
  rotation?: Partial<Vec3>;
  pivot?: Partial<Vec3>;
  scale?: Partial<Vec3>;
  class?: string;
}

export function SvgGroup(props: ParentProps<SvgGroupProps>) {
  const getParentMatrix = useParentMatrix();
  const viewBox = useViewBox();

  const localTransform = createMemo(() => {
    return buildLocalTransform(props, getViewBoxCenter(viewBox));
  });

  const worldMatrix = createMemo((): Mat4 => {
    const parentMatrix = getParentMatrix();
    const localMatrix = transformToMatrix(localTransform());
    return multiply(parentMatrix, localMatrix);
  });

  function getWorldMatrix() {
    return worldMatrix();
  }

  return (
    <ParentMatrixContext.Provider value={getWorldMatrix}>
      <g class={props.class} style={props.style} onClick={props.onClick}>
        {props.children}
      </g>
    </ParentMatrixContext.Provider>
  );
}
