import type { Component } from 'solid-js';
import type { WatermarkDecoratorProps } from '@lexical-core/nodes/WatermarkNode';

export const Watermark: Component<WatermarkDecoratorProps> = (props) => {
  return (
    <span
      class="select-none macro-watermark-node text-ink/50"
      inert
      data-watermark
    >
      {props.content}
    </span>
  );
};
