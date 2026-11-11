import INTER_LATIN from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline';
import type { PreviewFrame } from './frame-helper';
import { MACRO_STYLESHEET } from './macro-stylesheet';

/** What a page links to opt into Macro's look. */
export const MACRO_STYLES_HREF = 'macro:styles';

const STYLES_LINK = `link[rel~="stylesheet" i][href="${MACRO_STYLES_HREF}"]`;

/**
 * The app's Inter, which `--font-sans` names after the Apple system font. The
 * page's policy loads fonts only from `data:` URLs, so it is inlined; only
 * the Latin subset, to keep each page small.
 */
const INTER_FACE = `@font-face{font-family:"Inter Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url(${INTER_LATIN}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;

/** Host → frame: the app's theme changed; replace the page's theme rule. */
export type ThemeMessage = { type: 'macro:theme'; rule: string };

/**
 * Runs in the page beside its theme rule: swaps the rule when the host posts
 * a new one. Only the host can post as `parent`, and the rule is data the
 * host read from its own styles.
 */
const THEME_LISTENER = `(function (host) {
  addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== host || !data || data.type !== 'macro:theme' || typeof data.rule !== 'string') return;
    var style = document.querySelector('style[data-macro-theme]');
    if (style) style.textContent = data.rule;
  });
})(parent);`;

/**
 * Replaces the page's first `macro:styles` link with the viewer's theme
 * tokens (`themeRule`), Macro's stylesheet and the listener that keeps the
 * tokens current; later links are dropped. A page without the link is left
 * as it is. Returns whether the page links it.
 */
export function installMacroStyles(parsed: Document, themeRule: string) {
  const [first, ...rest] = Array.from(parsed.querySelectorAll(STYLES_LINK));
  if (!first) return false;

  const theme = parsed.createElement('style');
  theme.dataset.macroTheme = '';
  theme.textContent = themeRule;
  const sheet = parsed.createElement('style');
  sheet.textContent = `${INTER_FACE}${MACRO_STYLESHEET}`;
  const listener = parsed.createElement('script');
  listener.textContent = THEME_LISTENER;

  first.replaceWith(theme, sheet, listener);
  for (const link of rest) link.remove();
  return true;
}

/**
 * A page without programs, with Macro's styles installed when it links them.
 * Any other page is returned exactly as stored, so it renders as it would
 * with the rollout off.
 */
export function composePlainDocument(html: string, themeRule: string): string {
  if (!html.includes(MACRO_STYLES_HREF)) return html;

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  if (!installMacroStyles(parsed, themeRule)) return html;

  const doctype = parsed.doctype ? '<!doctype html>' : '';
  return `${doctype}${parsed.documentElement.outerHTML}`;
}

/** Send the frame's page the app's current theme rule. */
export function postFrameTheme(frame: PreviewFrame, rule: string) {
  const message: ThemeMessage = { type: 'macro:theme', rule };
  frame.contentWindow?.postMessage(message, '*');
}
