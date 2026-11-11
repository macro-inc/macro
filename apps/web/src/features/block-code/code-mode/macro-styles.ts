import type { PreviewFrame } from './frame-helper';
import { MACRO_STYLESHEET } from './macro-stylesheet';

/** What a page links to opt into Macro's look. */
export const MACRO_STYLES_HREF = 'macro:styles';

const STYLES_LINK = `link[rel~="stylesheet" i][href="${MACRO_STYLES_HREF}"]`;

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
  sheet.textContent = MACRO_STYLESHEET;
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
