import { fitToWidthZoom } from '../core/fit-to-width-zoom';
import type { PreparedEmailBody } from '../core/html';
import { processEmailColors, type ThemeColorParams } from './colors';
import { EMAIL_BODY_CONTAINMENT_CSS } from './email-body-containment-css';

export interface ResourceLifetime {
  readonly signal: AbortSignal;
  /** Late registration after disposal runs cleanup immediately. */
  onDispose(cleanup: () => void): void;
}
export interface BrowserOptions {
  theme: ThemeColorParams;
  adaptColors: boolean;
  normalizeFonts: boolean;
  expanded?: boolean;
  prepareLinks?: (container: HTMLElement) => void;
  resolveImages?: (
    root: ShadowRoot,
    lifetime: ResourceLifetime
  ) => Promise<void>;
  onResourceError?: (error: unknown) => void;
}
export interface EmailBodyRenderer {
  update(body: PreparedEmailBody, options: BrowserOptions): void;
  setExpanded(expanded: boolean): void;
  dispose(): void;
}

/** Owns one empty host's shadow tree. Call after connecting the host to the DOM. */
export function mountEmailBody(
  host: HTMLElement,
  body: PreparedEmailBody,
  options: BrowserOptions
): EmailBodyRenderer {
  const shadow = host.attachShadow({ mode: 'open' });
  let disposed = false;
  let cleanup = () => {};
  let applyExpanded = (_expanded: boolean) => {};

  function update(prepared: PreparedEmailBody, settings: BrowserOptions) {
    if (disposed) return;
    cleanup();
    const abort = new AbortController();
    const cleanups: (() => void)[] = [];
    const lifetime: ResourceLifetime = {
      signal: abort.signal,
      onDispose(fn) {
        if (abort.signal.aborted) fn();
        else cleanups.push(fn);
      },
    };
    cleanup = () => {
      abort.abort();
      for (const fn of cleanups.splice(0)) fn();
    };
    const style = document.createElement('style');
    const font = settings.normalizeFonts
      ? '*:not(code):not(pre):not(code *):not(pre *):not([data-macro-btn]){font-family:system-ui,sans-serif!important;font-size:inherit!important;line-height:1.5!important;}'
      : '';
    style.textContent = `:host{display:block;contain:content}${EMAIL_BODY_CONTAINMENT_CSS}${font}`;
    const content = document.createElement('div');
    content.innerHTML = prepared.html;
    for (const anchor of content.querySelectorAll<HTMLAnchorElement>('a')) {
      if (anchor.style.backgroundColor) {
        anchor.dataset.macroBtn = '';
        for (const child of anchor.querySelectorAll<HTMLElement>('*'))
          child.dataset.macroBtn = '';
      }
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    content.style.userSelect = 'text';
    content.style.setProperty('-webkit-user-select', 'text');
    content.style.cursor = 'auto';
    shadow.replaceChildren(style, content);
    settings.prepareLinks?.(content);

    let expanded = settings.expanded !== false;
    const measure = () => {
      if (abort.signal.aborted) return;
      content.style.zoom = '';
      content.style.overflow = '';
      content.style.overflowX = '';
      if (!expanded) return;
      const fit = fitToWidthZoom({
        containerWidth: host.clientWidth,
        contentWidth: content.scrollWidth,
      });
      if (!fit) return;
      content.style.zoom = `${fit.zoom}`;
      if (fit.overflowsAfterZoom) content.style.overflowX = 'auto';
    };
    applyExpanded = (value) => {
      expanded = value;
      host.style.setProperty(
        '--macro-email-img-display',
        value ? 'initial' : 'none'
      );
      measure();
    };
    applyExpanded(expanded);
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    lifetime.onDispose(() => observer.disconnect());
    // Capture catches non-bubbling load events, including resolved CID images.
    shadow.addEventListener('load', measure, true);
    lifetime.onDispose(() => shadow.removeEventListener('load', measure, true));
    const frame = requestAnimationFrame(() => {
      if (abort.signal.aborted) return;
      if (settings.adaptColors) processEmailColors(shadow, settings.theme);
      measure();
    });
    lifetime.onDispose(() => cancelAnimationFrame(frame));
    if (!settings.adaptColors) {
      content.style.setProperty('background-color', 'white', 'important');
      content.style.color = 'black';
    }
    // Call the adapter only while this generation is current. Errors belong to
    // the host's resource policy, never an unhandled fire-and-forget promise.
    Promise.resolve()
      .then(async () => {
        if (!abort.signal.aborted)
          await settings.resolveImages?.(shadow, lifetime);
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) settings.onResourceError?.(error);
      });
  }
  update(body, options);
  return {
    update,
    setExpanded(value) {
      if (!disposed) applyExpanded(value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanup();
      shadow.replaceChildren();
      host.style.removeProperty('--macro-email-img-display');
    },
  };
}
