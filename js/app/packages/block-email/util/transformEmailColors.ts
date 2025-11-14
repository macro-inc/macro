import { themeReactive } from '../../block-theme/signals/themeReactive';

export interface TextNodeContrast {
  text: string;
  fg: OKLCH | null;
  bg: OKLCH | null;
  node: Text;
  insideAnchor: boolean;
}

const CONTRAST_THRESHOLD = 0.5;
const EPSILON = 0.0001;

type RGBA = { r: number; g: number; b: number; a: number };
type OKLCH = { l: number; c: number; h: number; a?: number };

/**
 * Process the colors of the email content so that 1) the text colors are in line with our theme colors, and 2) the text colors have enough contrast with the background colors.
 * @param root - The root node of the email content.
 */
export function processEmailColors(root: Node) {
  const inkL = themeReactive.c0.l[0]();
  const inkC = themeReactive.c0.c[0]();
  const inkH = themeReactive.c0.h[0]();

  const panelL = themeReactive.b1.l[0]();

  const accentL = themeReactive.a0.l[0]();
  const accentC = themeReactive.a0.c[0]();
  const accentH = themeReactive.a0.h[0]();

  const themeIsDarkModish = inkL > panelL;
  const textNodeColors = computeTextNodeColor(root);
  // console.log('textNodeColors', textNodeColors);
  textNodeColors.forEach((textNodeColor) => {
    // if the text has a background color set, trust that the email sender's choices and don't change anything
    if ((textNodeColor.bg?.a ?? 0) > 0) return;
    if (!textNodeColor.fg) return;
    // if the text is inside an anchor tag, set the color to the accent ink color
    if (textNodeColor.insideAnchor) {
      setAnchorStyle(
        textNodeColor.node,
        'color',
        `oklch(${accentL} ${accentC} ${accentH})`
      );
      setAnchorStyle(textNodeColor.node, 'text-decoration-color', `oklch(${accentL} ${accentC} ${accentH})`);
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
    parentElement.style.color = color;
  }
}

function setAnchorStyle(node: Node, style: string, value: string) {
  const parentElement = node.parentElement;
  const anchorElement = parentElement?.closest('a');
  if (anchorElement) {
    anchorElement.style.setProperty(style, value);
  }
}

export function rgbaToOklch(rgba: RGBA | null): OKLCH | null {
  if (!rgba) return null;
  const { r, g, b, a } = rgba;
  function inverseGammaCorrection(component: number): number {
    return component <= 0.04045
      ? component / 12.92
      : Math.pow((component + 0.055) / 1.055, 2.4);
  }

  const linearR = inverseGammaCorrection(r);
  const linearG = inverseGammaCorrection(g);
  const linearB = inverseGammaCorrection(b);

  const okLabLCubed =
    linearR * 0.4122214708 + linearG * 0.5363325363 + linearB * 0.0514459929;
  const okLabMCubed =
    linearR * 0.2119034982 + linearG * 0.6806995451 + linearB * 0.1073969566;
  const okLabSCubed =
    linearR * 0.0883024619 + linearG * 0.2817188376 + linearB * 0.6299787005;

  const okLabL = Math.cbrt(okLabLCubed);
  const okLabM = Math.cbrt(okLabMCubed);
  const okLabS = Math.cbrt(okLabSCubed);

  const lightness =
    okLabL * 0.2104542553 + okLabM * 0.793617785 - okLabS * 0.0040720468;
  const a_ =
    okLabL * 1.9779984951 - okLabM * 2.428592205 + okLabS * 0.4505937099;
  const b_ =
    okLabL * 0.0259040371 + okLabM * 0.7827717662 - okLabS * 0.808675766;

  const chroma = Math.sqrt(a_ * a_ + b_ * b_);
  const hueInRadians = Math.atan2(b_, a_);
  const hueInDegrees = (hueInRadians * 180) / Math.PI;

  return {
    l: lightness,
    c: chroma,
    h: hueInDegrees < 0 ? hueInDegrees + 360 : hueInDegrees,
    a: a,
  };
}

function parseOKLCHString(s: string): OKLCH | null {
  const m = s.match(
    /oklch\(\s*([^\s]+)\s+([^\s]+)\s+([^\s/]+)(?:\s*\/\s*([^\s)]+))?\s*\)/i
  );
  if (!m) return null;

  const parsePctOrNumber = (x: string) => {
    const t = x.trim().toLowerCase();
    return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
  };

  const parseAngleToDegrees = (x: string) => {
    const t = x.trim().toLowerCase();
    if (t === 'none') return 0;
    if (t.endsWith('deg')) return parseFloat(t);
    if (t.endsWith('rad')) return (parseFloat(t) * 180) / Math.PI;
    if (t.endsWith('turn')) return parseFloat(t) * 360;
    if (t.endsWith('grad')) return parseFloat(t) * 0.9; // 400grad = 360deg
    return parseFloat(t); // unitless means degrees
  };

  const parseAlpha = (x?: string) => {
    if (!x) return 1;
    const t = x.trim().toLowerCase();
    if (t === 'none') return 0;
    return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
  };

  return {
    l: parsePctOrNumber(m[1]),
    c: parsePctOrNumber(m[2]),
    h: parseAngleToDegrees(m[3]),
    a: parseAlpha(m[4]),
  };
}

// parses the result of getComputedStyle().color
function parseRGBA(color: string): RGBA | null {
  if (!color) return null;
  const s = color.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const m = s.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/
  );
  if (m) {
    const r = parseFloat(m[1]);
    const g = parseFloat(m[2]);
    const b = parseFloat(m[3]);
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    return { r, g, b, a };
  }
  return null;
}

function normalizeRGBA(rgba: RGBA | null) {
  if (!rgba) return null;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  return {
    r: clamp01(rgba.r / 255),
    g: clamp01(rgba.g / 255),
    b: clamp01(rgba.b / 255),
    a: rgba.a,
  };
}

function computeTextNodeColor(root: Node): TextNodeContrast[] {
  const out: TextNodeContrast[] = [];

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
      const cs = getComputedStyle(el);
      const fg = cs.color.startsWith('rgb')
        ? normalizeRGBA(parseRGBA(cs.color))
        : null;
      const bg = cs.backgroundColor.startsWith('rgb')
        ? normalizeRGBA(parseRGBA(cs.backgroundColor))
        : null;
      if (fg) {
        const fgOklch = rgbaToOklch(fg);
        const bgOklch = rgbaToOklch(bg);
        const insideAnchor = el.closest('a') !== null;
        out.push({
          text: n.textContent || '',
          fg: fgOklch,
          bg: bgOklch,
          node: n,
          insideAnchor,
        });
      }
    }

    n = walker.nextNode() as Text | null;
  }

  return out;
}

export function findClosestContrastingColor(fg: OKLCH, bgL: number): OKLCH {
  const dir = fg.l > bgL ? 1 : -1;
  const candidate = bgL + dir * CONTRAST_THRESHOLD;
  const value =
    candidate >= 0 && candidate <= 1
      ? candidate
      : bgL - dir * CONTRAST_THRESHOLD;

  return { l: value, c: fg.c, h: fg.h, a: fg.a ?? 1 };
}
