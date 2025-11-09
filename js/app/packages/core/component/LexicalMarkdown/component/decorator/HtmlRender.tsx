import type { HtmlRenderDecoratorProps } from '@lexical-core/nodes/HtmlRenderNode';
import type { Component } from 'solid-js';

export const HtmlRender: Component<HtmlRenderDecoratorProps> = (props) => {
  return <div data-html-render="true" innerHTML={props.html} />;
};
