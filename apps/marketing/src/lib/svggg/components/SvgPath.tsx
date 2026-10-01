import { createMemo, For, type JSX, type ParentProps } from 'solid-js';
import type { Mat4, PathData, Vec3, ViewBox } from '../types/svgTypes';
import { ParentMatrixContext, useParentMatrix } from '../utils/svgContext';
import { multiply, transformToMatrix } from '../utils/svgMatrix';
import { buildPathWithMatrix } from '../utils/svgTransform';
import { buildLocalTransform, getViewBoxCenter } from '../utils/svgUtils';

interface SvgPathProps {
  onClick?: JSX.EventHandlerUnion<SVGGElement, MouseEvent>;
  translation?: Partial<Vec3>;
  style?: JSX.CSSProperties;
  rotation?: Partial<Vec3>;
  pivot?: Partial<Vec3>;
  scale?: Partial<Vec3>;
  paths?: PathData[];
  viewBox?: string;
  class?: string;
  id?: string;
}

export function SvgPath(props: ParentProps<SvgPathProps>) {
  const getParentMatrix = useParentMatrix();

  function getDefaultPivot(): Partial<Vec3> {
    if (!props.viewBox) return { x: 0, y: 0, z: 0 };
    const [minX, minY, width, height] = props.viewBox.split(' ').map(Number);
    const viewBox: ViewBox = { minX, minY, width, height };
    return getViewBoxCenter(viewBox);
  }

  const localTransform = createMemo(() => {
    return buildLocalTransform(props, getDefaultPivot());
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
      <g
        id={props.id}
        onClick={props.onClick}
        style={props.style}
        class={props.class}
      >
        {props.paths && (
          <For each={props.paths}>
            {(path) => (
              <path
                d={buildPathWithMatrix(path, worldMatrix())}
                {...path.attributes}
              />
            )}
          </For>
        )}
      </g>
      {props.children}
    </ParentMatrixContext.Provider>
  );
}
