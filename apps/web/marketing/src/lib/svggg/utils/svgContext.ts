import { createContext, useContext } from 'solid-js';
import { IDENTITY_MATRIX } from '../constants/constants';
import type { Mat4, ViewBox } from '../types/svgTypes';

export const ParentMatrixContext = createContext<() => Mat4>(
  () => IDENTITY_MATRIX
);

export function useParentMatrix(): () => Mat4 {
  return useContext(ParentMatrixContext);
}

export const ViewBoxContext = createContext<ViewBox>({
  minX: 0,
  minY: 0,
  width: 0,
  height: 0,
});

export function useViewBox(): ViewBox {
  return useContext(ViewBoxContext);
}
