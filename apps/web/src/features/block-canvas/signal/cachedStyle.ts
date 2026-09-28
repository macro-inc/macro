import { createMemo } from 'solid-js';
import { useCanvasDocument } from '../context/canvas-document-context';
import type { CanvasEntityStyle } from '../model/CanvasModel';

export function useCachedStyle() {
  const [style, setStyle] = useCanvasDocument().state.stores.cachedStyle;
  return {
    getStyle: createMemo(() => JSON.parse(JSON.stringify(style))),
    setProp: (prop: keyof CanvasEntityStyle, value: any) => {
      setStyle(prop, value);
    },
  };
}
