import { DEFAULT_TRANSFORM } from '../constants/constants';
import type { Transform3D, Vec3, ViewBox } from '../types/svgTypes';

export function getViewBoxCenter(viewBox: ViewBox): Vec3 {
  return {
    x: viewBox.minX + viewBox.width / 2,
    y: viewBox.minY + viewBox.height / 2,
    z: 0,
  };
}

export function lerp(current: number, target: number, factor: number) {
  return current + (target - current) * factor;
}

export interface TransformProps {
  translation?: Partial<Vec3>;
  rotation?: Partial<Vec3>;
  pivot?: Partial<Vec3>;
  scale?: Partial<Vec3>;
}

export function buildLocalTransform(
  props: TransformProps,
  defaultPivot: Partial<Vec3>
): Transform3D {
  const pivot = props.pivot ?? defaultPivot;

  return {
    ...DEFAULT_TRANSFORM,
    rx: props.rotation?.x ?? 0,
    ry: props.rotation?.y ?? 0,
    rz: props.rotation?.z ?? 0,
    tx: props.translation?.x ?? 0,
    ty: props.translation?.y ?? 0,
    tz: props.translation?.z ?? 0,
    sx: props.scale?.x ?? 1,
    sy: props.scale?.y ?? 1,
    sz: props.scale?.z ?? 1,
    cx: pivot?.x ?? 0,
    cy: pivot?.y ?? 0,
    cz: pivot?.z ?? 0,
  };
}
