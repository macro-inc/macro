import type { HtmlRenderDecoratorProps } from '@lexical-core/nodes/HtmlRenderNode';
import { type Component, createSignal, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';

export const HtmlRender: Component<HtmlRenderDecoratorProps> = (props) => {
  let marker: HTMLDivElement | undefined;
  const [shadowContainer, setShadowContainer] = createSignal<HTMLElement>();

  onMount(() => {
    const host = marker?.parentElement;
    if (!host) {
      return;
    }

    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    // Ensure a stable container for portal mounting
    let container = shadowRoot.querySelector<HTMLDivElement>(
      '[data-html-render-container]'
    );
    if (!container) {
      container = document.createElement('div');
      container.setAttribute('data-html-render-container', 'true');
      shadowRoot.appendChild(container);
    }
    setShadowContainer(container);
  });

  return (
    <>
      <div ref={marker} style={{ display: 'contents' }} />
      <Portal mount={shadowContainer()}>
        <div data-html-render="true" innerHTML={props.html} />
      </Portal>
    </>
  );
};
