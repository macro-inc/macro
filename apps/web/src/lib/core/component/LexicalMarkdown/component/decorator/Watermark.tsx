import type { WatermarkDecoratorProps } from '@macro-inc/lexical-core/nodes/WatermarkNode';
import type { Component } from 'solid-js';

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
