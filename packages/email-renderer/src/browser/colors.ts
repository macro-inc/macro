import {
  findClosestContrastingColor,
  normalizeRGBA,
  type OKLCH,
  parseRGBA,
  rgbaToOklch,
} from '../core/colors';

interface TextNodeContrast {
  text: string;
  fg: OKLCH | null;
  onBackground: boolean;
  node: Text;
  insideAnchor: boolean;
}

export interface ThemeColorParams {
  inkL: number;
  inkC: number;
  inkH: number;
  panelL: number;
  accentL: number;
  accentC: number;
  accentH: number;
}

const CONTRAST_THRESHOLD = 0.5;
const EPSILON = 0.0001;
// Chroma threshold for distinguishing grey-ish colors (e.g. #3c4043)
// from intentionally chromatic colors (e.g. #1a73e8)
const CHROMATIC_THRESHOLD = 0.04;

/**
 * Process the colors of the email content so that 1) the text colors are in line with our theme colors, and 2) the text colors have enough contrast with the background colors.
 * @param root - The root node of the email content.
 * @param theme - The theme color parameters.
 */
export function processEmailColors(root: Node, theme: ThemeColorParams) {
  const { inkL, inkC, inkH, panelL, accentL, accentC, accentH } = theme;

  const themeIsDarkModish = inkL > panelL;
  stripContentBackgrounds(root);
  const textNodeColors = computeTextNodeColor(root);
  textNodeColors.forEach((textNodeColor) => {
    // if the text has a background set, trust that the email sender's choices and don't change anything
    if (textNodeColor.onBackground) return;
    if (!textNodeColor.fg) return;
    // if the text is inside an anchor tag with a chromatic color, use the accent color;
    // grey/monochrome links fall through to normal text processing
    if (
      textNodeColor.insideAnchor &&
      textNodeColor.fg.c > CHROMATIC_THRESHOLD
    ) {
      const accentColor = `oklch(${accentL} ${accentC} ${accentH})`;
      setAnchorStyle(textNodeColor.node, 'color', accentColor);
      setAnchorStyle(textNodeColor.node, 'text-decoration-color', accentColor);
      // Also set color on the text node's parent to override intermediate elements
      // (e.g. <a><font color="#000000">text</font></a>)
      setNodeColor(textNodeColor.node, accentColor);
      return;
    }

    let newColor = { ...textNodeColor.fg };

    // clamp text lightness to ink lightness, and, if we're in a dark mode, invert text color lightness
    if (themeIsDarkModish) {
      newColor.l = Math.min(1 - textNodeColor.fg.l, inkL);
    } else {
      newColor.l = Math.max(textNodeColor.fg.l, inkL);
    }

    // if text color is monochrome, change it to ink chroma and hue
    if (newColor.c < EPSILON) {
      newColor.c = inkC;
      newColor.h = inkH;
    }

    const contrast = Math.abs(newColor.l - panelL);

    if (contrast < CONTRAST_THRESHOLD) {
      newColor = findClosestContrastingColor(newColor, panelL);
    }

    // if the new color is different from the original color, set the node color
    if (
      newColor.l !== textNodeColor.fg.l ||
      newColor.c !== textNodeColor.fg.c ||
      newColor.h !== textNodeColor.fg.h
    ) {
      const newColorOKLCH = `oklch(${newColor.l} ${newColor.c} ${newColor.h})`;
      setNodeColor(textNodeColor.node, newColorOKLCH);
    }
  });
}

function setNodeColor(node: Node, color: string) {
  const parentElement = node.parentElement;
  if (parentElement) {
    parentElement.style.setProperty('color', color, 'important');
  }
}

function setAnchorStyle(node: Node, style: string, value: string) {
  const parentElement = node.parentElement;
  const anchorElement = parentElement?.closest('a');
  if (anchorElement) {
    anchorElement.style.setProperty(style, value, 'important');
  }
}

const LIGHT_BG_THRESHOLD = 0.85;
const COLOR_FUNCTION =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi;

function isLightColor(color: string): boolean {
  if (!color.startsWith('rgb')) return false;
  const rgba = normalizeRGBA(parseRGBA(color));
  if (!rgba || rgba.a === 0) return false;
  const oklch = rgbaToOklch(rgba);
  return !!oklch && oklch.l > LIGHT_BG_THRESHOLD;
}

/** A computed background-image made only of gradients whose visible stops are
 *  all light. Image URLs and colors we can't read keep the sender's design. */
function isLightGradient(backgroundImage: string): boolean {
  if (backgroundImage === 'none' || backgroundImage.includes('url(')) {
    return false;
  }
  const stops = backgroundImage.match(COLOR_FUNCTION) ?? [];
  return (
    stops.length > 0 &&
    stops.every((stop) => {
      const rgba = parseRGBA(stop);
      return rgba?.a === 0 || isLightColor(stop);
    })
  );
}

/** True when the element paints its own background: an opaque color, a
 *  gradient, or an image. */
function hasOwnBackground(style: {
  backgroundColor: string;
  backgroundImage: string;
}): boolean {
  if (style.backgroundImage !== 'none') return true;
  const color = normalizeRGBA(parseRGBA(style.backgroundColor));
  return !!color && color.a > 0;
}

/** Remove light/white backgrounds from all elements, preserving colored/dark backgrounds (buttons, banners).
 *  Light gradients count as light backgrounds; background images stay.
 *  Uses getComputedStyle to resolve all color formats (named colors, hex, rgb, etc.) */
function stripContentBackgrounds(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let el = walker.nextNode();
  while (el) {
    if (el instanceof HTMLElement) {
      const style = getComputedStyle(el);
      const lightColor = isLightColor(style.backgroundColor);
      // A light gradient over the element's own dark color is one layer of
      // the sender's design; removing it alone would expose the dark color.
      const ownColor = normalizeRGBA(parseRGBA(style.backgroundColor));
      const lightGradient =
        isLightGradient(style.backgroundImage) &&
        (lightColor || !ownColor || ownColor.a === 0);
      if (
        (lightColor || lightGradient) &&
        !hasOpaqueAncestorBackground(el, root)
      ) {
        if (lightColor) {
          el.style.setProperty('background-color', 'transparent', 'important');
          el.removeAttribute('bgcolor');
        }
        if (lightGradient) {
          el.style.setProperty('background-image', 'none', 'important');
        }
      }
    }
    el = walker.nextNode();
  }
}

/** True if an ancestor still has an opaque background. Parents are visited
 *  before children, so any remaining opaque ancestor bg is one we kept
 *  (non-light, or an image) — a light bg layered on it is content (e.g. a
 *  button face inside a colored border div), not page chrome, and stripping it
 *  would expose the colored bg behind text that wasn't styled to contrast with it. */
function hasOpaqueAncestorBackground(el: HTMLElement, root: Node): boolean {
  let ancestor = el.parentElement;
  while (ancestor && ancestor !== root) {
    if (hasOwnBackground(getComputedStyle(ancestor))) return true;
    ancestor = ancestor.parentElement;
  }
  return false;
}

function computeTextNodeColor(root: Node): TextNodeContrast[] {
  const out: TextNodeContrast[] = [];
  // This pass only reads styles; processEmailColors writes after it returns.
  // Snapshot primitives once per element rather than repeatedly resolving every
  // text node's entire ancestor chain. Keep caches local to this presentation.
  const styles = new Map<
    Element,
    { color: string; backgroundColor: string; backgroundImage: string }
  >();
  const backgrounds = new Map<Element, boolean>();
  const readStyle = (element: Element) => {
    const cached = styles.get(element);
    if (cached) return cached;
    const computed = getComputedStyle(element);
    const value = {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
    };
    styles.set(element, value);
    return value;
  };
  const isOnBackground = (element: Element): boolean => {
    const ancestors: Element[] = [];
    let current: Element | null = element;
    let onBackground = false;
    while (current && current !== root) {
      const cached = backgrounds.get(current);
      if (cached !== undefined) {
        onBackground = cached;
        break;
      }
      ancestors.push(current);
      if (hasOwnBackground(readStyle(current))) {
        onBackground = true;
        break;
      }
      current = current.parentElement;
    }
    for (const ancestor of ancestors) backgrounds.set(ancestor, onBackground);
    return onBackground;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      return node.textContent && node.textContent.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  let n = walker.nextNode() as Text | null;
  while (n) {
    let el: Element | null = n.parentElement;
    if (!el) {
      let p = n.parentNode;
      while (p && p.nodeType !== Node.ELEMENT_NODE) p = p.parentNode;
      el = p as Element | null;
    }

    if (el) {
      const cs = readStyle(el);
      const fg = cs.color.startsWith('rgb')
        ? normalizeRGBA(parseRGBA(cs.color))
        : null;
      // Walk up ancestors to find a painted background, since backgrounds
      // don't inherit in CSS
      const onBackground = isOnBackground(el);
      if (fg) {
        const fgOklch = rgbaToOklch(fg);
        const insideAnchor = el.closest('a') !== null;
        out.push({
          text: n.textContent || '',
          fg: fgOklch,
          onBackground,
          node: n,
          insideAnchor,
        });
      }
    }

    n = walker.nextNode() as Text | null;
  }

  return out;
}
