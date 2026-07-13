import {
  processEmailColors,
  stripColorSchemeMediaQueries,
  type ThemeColorParams,
} from '@core/email';
import type { HtmlRenderDecoratorProps } from '@macro-inc/lexical-core/nodes/HtmlRenderNode';
import { themeReactive } from '@theme/signals/themeReactive';
import { themeUpdate } from '@theme/signals/themeSignals';
import {
  type Component,
  createEffect,
  createSignal,
  onMount,
  untrack,
} from 'solid-js';
import { Portal } from 'solid-js/web';

export const HtmlRender: Component<HtmlRenderDecoratorProps> = (props) => {
  let marker: HTMLDivElement | undefined;
  const [shadowContainer, setShadowContainer] = createSignal<HTMLElement>();
  const [content, setContent] = createSignal<HTMLDivElement>();

  onMount(() => {
    const host = marker?.parentElement;
    if (!host) {
      return;
    }

    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    // Base style mirroring the email message view's shadow root
    if (!shadowRoot.querySelector('style')) {
      const styleEl = document.createElement('style');
      styleEl.textContent =
        'img{max-width:100% !important;height:auto !important;}' +
        'blockquote{margin-block:0.75em!important;margin-inline-start:1.5em!important;margin-inline-end:0!important;max-width:100%!important;box-sizing:border-box;}';
      shadowRoot.appendChild(styleEl);
    }

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

  // Match the message view's rendering: strip light backgrounds and adapt
  // text colors to the theme (or force a white panel for table-layout emails).
  // Display-only — the node's raw html is what exportDOM sends.
  createEffect(() => {
    themeUpdate();
    const el = content();
    if (!el) return;
    // Reset to the raw html so recoloring never compounds
    el.innerHTML = props.html;
    for (const styleEl of el.querySelectorAll('style')) {
      styleEl.textContent = stripColorSchemeMediaQueries(
        styleEl.textContent ?? ''
      );
    }
    const adapt = props.adaptColors ?? !el.querySelector('table');
    queueMicrotask(() => {
      untrack(() => {
        if (!el.isConnected) return;
        if (adapt) {
          el.style.removeProperty('background-color');
          el.style.removeProperty('color');
          const theme: ThemeColorParams = {
            inkL: themeReactive.c0.l[0](),
            inkC: themeReactive.c0.c[0](),
            inkH: themeReactive.c0.h[0](),
            panelL: themeReactive.b1.l[0](),
            accentL: themeReactive.a0.l[0](),
            accentC: themeReactive.a0.c[0](),
            accentH: themeReactive.a0.h[0](),
          };
          processEmailColors(el, theme);
        } else {
          el.style.setProperty('background-color', 'white', 'important');
          // Some emails don't set a color, so force black for readability
          // against the forced white background
          el.style.setProperty('color', 'black');
        }
      });
    });
  });

  return (
    <>
      <div ref={marker} style={{ display: 'contents' }} />
      <Portal mount={shadowContainer()}>
        {/* contain: floats/positioned content in email HTML must size and
            paint within this node, not over siblings below the editor */}
        <div
          ref={setContent}
          data-html-render="true"
          style={{ contain: 'layout' }}
        />
      </Portal>
    </>
  );
};
