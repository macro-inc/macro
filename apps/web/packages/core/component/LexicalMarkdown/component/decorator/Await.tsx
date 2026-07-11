import type { AwaitDecoratorProps } from '@lexical-core';
import type { Component } from 'solid-js';

export const Await: Component<AwaitDecoratorProps> = (props) => {
  return (
    <span
      class="animate-pulse text-current/50 select-none bg-current/5 rounded-xs"
      inert
      data-await-id={props.awaitId}
    >
      {props.text ?? 'Waiting…'}
    </span>
  );
};
