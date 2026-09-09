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

/** Owns one empty host's shadow tree; visual preparation waits for attachment. */
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
    for (const anchor of content.querySelectorAll<
      HTMLAnchorElement | HTMLAreaElement
    >('a, area')) {
      if (anchor.tagName === 'A' && anchor.style.backgroundColor) {
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
    let colorsPrepared = false;
    const refresh = () => {
      // Solid can create a host well before inserting it. Computed colors are
      // unavailable while detached; retry on attachment via ResizeObserver.
      if (abort.signal.aborted || !host.isConnected) return;
      if (!colorsPrepared) {
        if (settings.adaptColors) processEmailColors(shadow, settings.theme);
        colorsPrepared = true;
      }
      content.style.zoom = '';
      content.style.overflowX = '';
      content.style.overflow = expanded ? '' : 'hidden';
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
      // Host containment prevents an ancestor's line clamp from reaching this
      // content, so the collapsed summary must be clipped inside the boundary.
      content.style.display = value ? '' : '-webkit-box';
      content.style.webkitBoxOrient = value ? '' : 'vertical';
      content.style.webkitLineClamp = value ? '' : '3';
      host.style.setProperty(
        '--macro-email-img-display',
        value ? 'initial' : 'none'
      );
      refresh();
    };
    applyExpanded(expanded);
    const observer = new ResizeObserver(refresh);
    observer.observe(host);
    lifetime.onDispose(() => observer.disconnect());
    // Capture catches non-bubbling load events, including resolved CID images.
    shadow.addEventListener('load', refresh, true);
    lifetime.onDispose(() => shadow.removeEventListener('load', refresh, true));
    // Cover synchronous framework insertion without depending on a paint frame
    // (which can be suspended in a background tab or embedded browser).
    queueMicrotask(refresh);
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
