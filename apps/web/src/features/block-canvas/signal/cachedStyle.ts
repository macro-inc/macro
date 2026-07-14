import { createBlockStore } from '@core/block';
import { createMemo } from 'solid-js';
import {
  type CanvasEntityStyle,
  EdgeConnectionStyles,
} from '../model/CanvasModel';
import { getTailwindColor } from '../util/style';

const defaultStyle: () => CanvasEntityStyle = () => ({
  fillColor: getTailwindColor('neutral-100'),
  strokeColor: getTailwindColor('neutral-700'),
  strokeWidth: 2,
  cornerRadius: 0,
  opacity: 1,
  textSize: 16,
  connectionStyle: EdgeConnectionStyles.straight,
});

const cachedStyle = createBlockStore<CanvasEntityStyle>(defaultStyle());

export function useCachedStyle() {
  const [style, setStyle] = cachedStyle;
  return {
    getStyle: createMemo(() => JSON.parse(JSON.stringify(style))),
    setProp: (prop: keyof CanvasEntityStyle, value: any) => {
      setStyle(prop, value);
    },
  };
}
