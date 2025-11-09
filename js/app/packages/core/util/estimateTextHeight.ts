interface TwStyle {
  [key: string]: string | number | TwStyle;
}

const WIDEST_GLYPHS = ['W', 'M', '@'];
const TALLEST_GLPYHS = '/@#|]'; // judging height can be a contiguous string since the height will be based on the tallest

type Dim = [width: number, height: number];
type Dims = { heightPadding: number; glyph: Dim };

declare global {
  var maxDimPx: Map<string, Dims>;
}

// key: fontClass, value: estimated glyph dimensions in px and associated padding in px
globalThis.maxDimPx = new Map<string, Dims>();

function calculatePxHeight(
  textLength: number,
  maxDimPx: Dims,
  containerWidthPx: number
) {
  const [width, height] = maxDimPx.glyph;
  const lineCount = (textLength * width) / containerWidthPx;
  return Math.ceil(lineCount * height) + maxDimPx.heightPadding;
}

function estimateTextHeight_(
  text: string,
  fontStyleName: string,
  containerWidthPx: number,
  fontStyle?: TwStyle,
  fontCss?: string
) {
  const maybeResult = globalThis.maxDimPx.get(fontStyleName);
  if (maybeResult)
    return calculatePxHeight(text.length, maybeResult, containerWidthPx);

  const el = document.createElement('div');
  if (fontCss) el.className = fontCss;
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  el.style.whiteSpace = 'normal';
  Object.assign(el.style, fontStyle);
  document.body.appendChild(el);
  const heightPadding = el.clientHeight;
  const widthPadding = el.clientWidth;
  el.innerText = TALLEST_GLPYHS;

  el.style.margin = '';
  el.style.padding = '';
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  el.style.whiteSpace = 'normal';

  let maxWidth = 0;
  for (const glpyh of WIDEST_GLYPHS) {
    el.innerText = glpyh;
    maxWidth = Math.max(
      fontStyle ? el.clientWidth : el.clientWidth - widthPadding,
      maxWidth
    );
  }

  el.style.position = 'absolute';
  el.style.left = '-9999px';
  el.style.whiteSpace = 'normal';
  Object.assign(el.style, fontStyle);
  el.style.margin = '';
  el.style.padding = '';
  el.style.width = `${containerWidthPx}px`;
  el.innerText = TALLEST_GLPYHS;
  const maxHeight = fontStyle
    ? el.clientHeight
    : el.clientHeight - heightPadding;
  document.body.removeChild(el);

  const result: Dims = { glyph: [maxWidth, maxHeight], heightPadding };
  globalThis.maxDimPx.set(fontStyleName, result);
  return calculatePxHeight(text.length, result, containerWidthPx);
}

/**
 * Estimates the height of a given text, considering the specified font name, font size, and container width.
 * The results are cached within a margin of error, determined by the width of the widest/tallest character in the given font and size.
 *
 * @param text The string of text.
 * @param fontStyleName unique name for style
 * @param fontStyle The matching tw``
 * @param containerWidth The width of the container for the text in pixels.
 * @returns The estimated height of the text in pixels.
 *
 * @example Using twin.macro, estimateTextHeight('Macronauts assemble!', tw`text-sm font-bold`, 200)
 */
export function estimateTextHeight(
  text: string,
  fontStyleName: string,
  fontStyle: TwStyle,
  containerWidthPx: number
): number {
  return estimateTextHeight_(text, fontStyleName, containerWidthPx, fontStyle);
}

/**
 * Estimates the height of a given text, considering the specified font name, font size, and container width.
 * The results are cached within a margin of error, determined by the width of the widest/tallest character in the given font and size.
 *
 * @param text The string of text.
 * @param fontStyleName unique name for style
 * @param fontCss The CSS class
 * @param containerWidth The width of the container for the text in pixels.
 * @returns The estimated height of the text in pixels.
 *
 * @example Using twin.macro, estimateTextHeight('Macronauts assemble!', tw`text-sm font-bold`, 200)
 */
export function estimateTextHeightCss(
  text: string,
  fontStyleName: string,
  fontCss: string,
  containerWidthPx: number
): number {
  return estimateTextHeight_(
    text,
    fontStyleName,
    containerWidthPx,
    undefined,
    fontCss
  );
}
