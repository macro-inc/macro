// @vitest-environment jsdom
/**
 * Differential test: the branch memoizes computed styles and effective
 * backgrounds inside computeTextNodeColor. Drive origin/main's uncached
 * algorithm (embedded below) and the branch's processEmailColors over many
 * generated DOM trees and assert they make identical style writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findClosestContrastingColor,
  normalizeRGBA,
  type OKLCH,
  parseRGBA,
  type RGBA,
  rgbaToOklch,
} from '../core/colors';
import { processEmailColors } from './colors';

// ---- origin/main:packages/email-renderer/src/browser/colors.ts (renamed) ----

interface TextNodeContrast {
  text: string;
  fg: OKLCH | null;
  bg: OKLCH | null;
  node: Text;
  insideAnchor: boolean;
}

interface MainThemeColorParams {
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
function processEmailColorsMain(root: Node, theme: MainThemeColorParams) {
  const { inkL, inkC, inkH, panelL, accentL, accentC, accentH } = theme;

  const themeIsDarkModish = inkL > panelL;
  stripContentBackgrounds(root);
  const textNodeColors = computeTextNodeColor(root);
  textNodeColors.forEach((textNodeColor) => {
    // if the text has a background color set, trust that the email sender's choices and don't change anything
    if ((textNodeColor.bg?.a ?? 0) > 0) return;
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

/** Remove light/white backgrounds from all elements, preserving colored/dark backgrounds (buttons, banners).
 *  Uses getComputedStyle to resolve all color formats (named colors, hex, rgb, etc.) */
function stripContentBackgrounds(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let el = walker.nextNode();
  while (el) {
    if (el instanceof HTMLElement) {
      const bgColor = getComputedStyle(el).backgroundColor;
      if (bgColor && bgColor.startsWith('rgb')) {
        const rgba = normalizeRGBA(parseRGBA(bgColor));
        if (rgba && rgba.a > 0) {
          const oklch = rgbaToOklch(rgba);
          if (
            oklch &&
            oklch.l > LIGHT_BG_THRESHOLD &&
            !hasOpaqueAncestorBackground(el, root)
          ) {
            el.style.setProperty(
              'background-color',
              'transparent',
              'important'
            );
            el.removeAttribute('bgcolor');
          }
        }
      }
    }
    el = walker.nextNode();
  }
}

/** True if an ancestor still has an opaque background. Parents are visited
 *  before children, so any remaining opaque ancestor bg is one we kept
 *  (non-light) — a light bg layered on it is content (e.g. a button face
 *  inside a colored border div), not page chrome, and stripping it would
 *  expose the colored bg behind text that wasn't styled to contrast with it. */
function hasOpaqueAncestorBackground(el: HTMLElement, root: Node): boolean {
  let ancestor = el.parentElement;
  while (ancestor && ancestor !== root) {
    const bg = normalizeRGBA(
      parseRGBA(getComputedStyle(ancestor).backgroundColor)
    );
    if (bg && bg.a > 0) return true;
    ancestor = ancestor.parentElement;
  }
  return false;
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
      // Walk up ancestors to find the effective background color,
      // since background-color doesn't inherit in CSS
      let bgRgba: RGBA | null = null;
      let bgEl: Element | null = el;
      while (bgEl && bgEl !== root) {
        const bgCs = getComputedStyle(bgEl);
        const parsed = bgCs.backgroundColor.startsWith('rgb')
          ? normalizeRGBA(parseRGBA(bgCs.backgroundColor))
          : null;
        if (parsed && parsed.a > 0) {
          bgRgba = parsed;
          break;
        }
        bgEl = bgEl.parentElement;
      }
      if (fg) {
        const fgOklch = rgbaToOklch(fg);
        const bgOklch = rgbaToOklch(bgRgba);
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
// ---- end of origin/main copy ----

const NAMED: Record<string, string> = {
  white: 'rgb(255, 255, 255)',
  black: 'rgb(0, 0, 0)',
  red: 'rgb(255, 0, 0)',
  transparent: 'rgba(0, 0, 0, 0)',
};
function toComputed(value: string, fallback: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  if (NAMED[v]) return NAMED[v];
  const hex = v.match(/^#([0-9a-f]{6})$/);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
  return v; // rgb()/rgba() stay; oklch()/others are not rgb (as in browsers)
}

/** Deterministic cascade: color inherits through elements, background does not. */
function fakeComputedStyle(element: Element) {
  let color = '';
  for (let el: Element | null = element; el; el = el.parentElement) {
    const own =
      (el as HTMLElement).style?.getPropertyValue('color') ||
      el.getAttribute('data-color') ||
      '';
    if (own) {
      color = own;
      break;
    }
  }
  const background =
    (element as HTMLElement).style?.getPropertyValue('background-color') ||
    element.getAttribute('data-bg') ||
    '';
  return {
    color: toComputed(color, 'rgb(0, 0, 0)'),
    backgroundColor: toComputed(background, 'rgba(0, 0, 0, 0)'),
  } as CSSStyleDeclaration;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(random: () => number, values: readonly T[]) =>
  values[Math.floor(random() * values.length)];

const COLORS = [
  '',
  '',
  '#000000',
  '#333333',
  '#ffffff',
  '#1a73e8',
  '#3c4043',
  'rgba(0, 0, 0, 0.5)',
  'red',
  'oklch(0.5 0.1 200)',
];
const BACKGROUNDS = [
  '',
  '',
  '',
  '#ffffff',
  '#fafafa',
  '#202124',
  '#1a73e8',
  'rgba(255, 255, 255, 0)',
  'rgba(10, 10, 10, 0.4)',
  'transparent',
];
const TAGS = ['div', 'span', 'p', 'a', 'td', 'font', 'b', 'table'];

function build(random: () => number, parent: Node, depth: number) {
  const children = 1 + Math.floor(random() * 3);
  for (let i = 0; i < children; i++) {
    if (depth >= 4 || random() < 0.3) {
      parent.appendChild(
        document.createTextNode(pick(random, ['Hello', ' ', 'Link', '\n', 'x']))
      );
      continue;
    }
    const el = document.createElement(pick(random, TAGS));
    const color = pick(random, COLORS);
    const bg = pick(random, BACKGROUNDS);
    if (color) el.setAttribute('data-color', color);
    if (bg) el.setAttribute('data-bg', bg);
    if (random() < 0.2) el.setAttribute('bgcolor', '#ffffff');
    parent.appendChild(el);
    build(random, el, depth + 1);
  }
}

function pathOf(node: Node, root: Node): string {
  const parts: number[] = [];
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) {
    parts.unshift(
      Array.prototype.indexOf.call(n.parentNode?.childNodes ?? [], n)
    );
  }
  return parts.join('/');
}

const themes = [
  {
    inkL: 0.2,
    inkC: 0,
    inkH: 0,
    panelL: 1,
    accentL: 0.6,
    accentC: 0.1,
    accentH: 50,
  },
  {
    inkL: 0.92,
    inkC: 0.01,
    inkH: 250,
    panelL: 0.16,
    accentL: 0.7,
    accentC: 0.12,
    accentH: 260,
  },
];

describe('computeTextNodeColor caching is equivalent to main', () => {
  beforeEach(() => {
    vi.stubGlobal('getComputedStyle', fakeComputedStyle);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('makes identical writes over generated trees (shadow and element roots)', () => {
    const writes: string[] = [];
    let active: Node | undefined;
    const setProperty = CSSStyleDeclaration.prototype.setProperty;
    const removeAttribute = Element.prototype.removeAttribute;
    const spy = vi
      .spyOn(CSSStyleDeclaration.prototype, 'setProperty')
      .mockImplementation(function (this: CSSStyleDeclaration, ...args) {
        // Record decisions; jsdom may reject oklch() values.
        const owner = [...(active as ParentNode).querySelectorAll('*')].find(
          (el) => (el as HTMLElement).style === this
        );
        if (owner) writes.push(`${pathOf(owner, active!)} ${args.join(' ')}`);
        // Mirror the write in the fake cascade for subsequent reads.
        if (owner && args[0] === 'background-color')
          owner.setAttribute('data-bg', String(args[1]));
        return setProperty.apply(this, args as Parameters<typeof setProperty>);
      });
    const attr = vi
      .spyOn(Element.prototype, 'removeAttribute')
      .mockImplementation(function (this: Element, name: string) {
        if (active) writes.push(`${pathOf(this, active)} -${name}`);
        return removeAttribute.call(this, name);
      });
    try {
      const failures: string[] = [];
      let colorWrites = 0;
      let stripped = 0;
      for (let seed = 1; seed <= 1500 && failures.length < 3; seed++) {
        const random = rng(seed);
        const template = document.createElement('div');
        build(random, template, 0);
        const theme = pick(random, themes);
        const useShadow = random() < 0.5;
        const run = (process: (root: Node, t: typeof theme) => void) => {
          writes.length = 0;
          let root: Node;
          if (useShadow) {
            const host = document.createElement('div');
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.append(...template.cloneNode(true).childNodes);
            root = shadow;
          } else {
            root = template.cloneNode(true);
          }
          active = root;
          process(root, theme);
          active = undefined;
          return [...writes];
        };
        const expected = run(processEmailColorsMain);
        const actual = run(processEmailColors);
        if (expected.some((w) => w.includes(' color '))) colorWrites++;
        if (expected.some((w) => w.includes('transparent'))) stripped++;
        if (JSON.stringify(expected) !== JSON.stringify(actual))
          failures.push(
            `seed ${seed} (${useShadow ? 'shadow' : 'element'} root)\n${template.innerHTML}\nmain:   ${JSON.stringify(expected)}\nbranch: ${JSON.stringify(actual)}`
          );
      }
      expect(failures).toEqual([]);
      // The generator must actually exercise both write paths.
      expect(colorWrites).toBeGreaterThan(200);
      expect(stripped).toBeGreaterThan(200);
    } finally {
      spy.mockRestore();
      attr.mockRestore();
    }
  });
});
