import { type RichText, richTextPlainText } from '../core/rich-text';
import type { TextFont, TextGeometry, TextMeasurer } from '../core/shapes/text';
export const textFonts: Readonly<Record<TextFont, string>> = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!
  );
/** Safe plain fallback. Rich editor hosts supply their own content renderer. */
export const richTextHtml = (content: RichText): string =>
  escapeHtml(richTextPlainText(content)).replaceAll('\n', '<br>');
export const textLayoutStyle = (geometry: TextGeometry) => ({
  'font-family': textFonts[geometry.fontFamily],
  'font-size': `${geometry.fontSize}px`,
  width: geometry.autoWidth ? 'max-content' : `${geometry.width}px`,
  'min-width': '1px',
});
/** One disposable measurement element per host, sharing the rendered text styles. */
export function createTextMeasurer() {
  const element = document.createElement('div');
  element.className = 'graphics-rich-text';
  Object.assign(element.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  element.setAttribute('aria-hidden', 'true');
  document.body.append(element);
  const measure: TextMeasurer = (geometry) => {
    const style = textLayoutStyle(geometry);
    for (const [key, value] of Object.entries(style))
      element.style.setProperty(key, value);
    element.innerHTML = richTextHtml(geometry.content);
    const rect = element.getBoundingClientRect();
    return {
      width: geometry.autoWidth ? Math.max(1, rect.width) : geometry.width,
      height: Math.max(geometry.fontSize * 1.35, rect.height),
    };
  };
  return { measure, dispose: () => element.remove() };
}
