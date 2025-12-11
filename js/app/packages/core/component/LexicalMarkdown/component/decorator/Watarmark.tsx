import type { WatermarkDecoratorProps } from '@lexical-core/nodes/WatermarkNode';
import type { Component } from 'solid-js';

export const Watermark: Component<WatermarkDecoratorProps> = (props) => {
  return (
    <div class="select-none" inert onClick={() => console.log('Press')}>
      {props.content}
    </div>
  );
};
