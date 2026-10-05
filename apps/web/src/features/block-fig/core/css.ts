/**
 * CSS for a layer, as Figma's Dev Mode writes it: size, background, border,
 * radius, shadows, opacity, and text styles.
 */

import type { EffectInfo, NodeInfo, PaintInfo } from '@core/fig-engine/types';

const round = (v: number) => Math.round(v * 100) / 100;
const px = (v: number) => `${round(v)}px`;

/** `#RRGGBB` or `rgba(…)` for a color with alpha. */
export function cssColor(hex: string, alpha = 1): string {
  if (alpha >= 0.999) return `#${hex}`;
  const n = Number.parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${round(alpha)})`;
}

function paintCss(p: PaintInfo): string | undefined {
  if (!p.visible) return undefined;
  if (p.type === 'SOLID' && p.color)
    return cssColor(p.color, (p.alpha ?? 1) * p.opacity);
  if (p.stops && p.type.startsWith('GRADIENT')) {
    const stops = p.stops
      .map(
        (s) =>
          `${cssColor(s.color, s.alpha * p.opacity)} ${round(s.position * 100)}%`
      )
      .join(', ');
    if (p.type === 'GRADIENT_LINEAR') {
      let angle = 90;
      if (p.handles) {
        const [a, b] = p.handles;
        // CSS angles start at "to top" and run clockwise.
        angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
      }
      return `linear-gradient(${round(angle)}deg, ${stops})`;
    }
    if (p.type === 'GRADIENT_ANGULAR')
      return `conic-gradient(from 90deg, ${stops})`;
    return `radial-gradient(50% 50% at 50% 50%, ${stops})`;
  }
  return undefined;
}

function shadowCss(e: EffectInfo): string | undefined {
  if (!e.visible) return undefined;
  if (e.type !== 'DROP_SHADOW' && e.type !== 'INNER_SHADOW') return undefined;
  const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
  return `${inset}${px(e.x)} ${px(e.y)} ${px(e.radius)} ${px(e.spread)} ${cssColor(e.color, e.alpha)}`;
}

export function cssFor(info: NodeInfo): string[] {
  const lines: string[] = [];
  lines.push(`width: ${px(info.width)};`, `height: ${px(info.height)};`);
  if (Math.abs(info.rotation) > 0.01)
    lines.push(`transform: rotate(${round(-info.rotation)}deg);`);
  if (info.type !== 'TEXT') {
    const fills = info.fills.map(paintCss).filter(Boolean).reverse();
    if (fills.length === 1 && !fills[0]?.includes('gradient'))
      lines.push(`background: ${fills[0]};`);
    else if (fills.length > 0) lines.push(`background: ${fills.join(', ')};`);
  } else {
    const color = info.fills.map(paintCss).find(Boolean);
    if (color) lines.push(`color: ${color};`);
  }
  const stroke = info.strokes.map(paintCss).find(Boolean);
  if (stroke && info.strokeWeight) {
    const style = info.dashPattern?.length ? 'dashed' : 'solid';
    lines.push(`border: ${px(info.strokeWeight)} ${style} ${stroke};`);
  }
  const r = info.cornerRadius;
  if (r) {
    const values = [r.top_left, r.top_right, r.bottom_right, r.bottom_left];
    lines.push(
      values.every((v) => v === values[0])
        ? `border-radius: ${px(values[0])};`
        : `border-radius: ${values.map(px).join(' ')};`
    );
  }
  const shadows = info.effects.map(shadowCss).filter(Boolean);
  if (shadows.length > 0) lines.push(`box-shadow: ${shadows.join(', ')};`);
  const blur = info.effects.find((e) => e.visible && e.type === 'LAYER_BLUR');
  if (blur) lines.push(`filter: blur(${px(blur.radius / 2)});`);
  const backdrop = info.effects.find(
    (e) => e.visible && e.type === 'BACKGROUND_BLUR'
  );
  if (backdrop)
    lines.push(`backdrop-filter: blur(${px(backdrop.radius / 2)});`);
  if (info.opacity < 0.999) lines.push(`opacity: ${round(info.opacity)};`);
  const t = info.text;
  if (t) {
    if (t.fontFamily) lines.push(`font-family: "${t.fontFamily}";`);
    if (t.fontSize) lines.push(`font-size: ${px(t.fontSize)};`);
    const weight = fontWeight(t.fontStyle);
    if (weight) lines.push(`font-weight: ${weight};`);
    if (t.fontStyle?.toLowerCase().includes('italic'))
      lines.push('font-style: italic;');
    if (t.lineHeight && t.lineHeight[1] !== 'RAW') {
      const [v, unit] = t.lineHeight;
      lines.push(
        `line-height: ${unit === 'PERCENT' ? `${round(v)}%` : px(v)};`
      );
    }
    if (t.letterSpacing && t.letterSpacing[0] !== 0) {
      const [v, unit] = t.letterSpacing;
      lines.push(
        `letter-spacing: ${unit === 'PERCENT' ? `${round(v / 100)}em` : px(v)};`
      );
    }
    if (t.alignHorizontal && t.alignHorizontal !== 'LEFT')
      lines.push(
        `text-align: ${t.alignHorizontal === 'JUSTIFIED' ? 'justify' : t.alignHorizontal.toLowerCase()};`
      );
    if (t.decoration === 'UNDERLINE') lines.push('text-decoration: underline;');
    if (t.decoration === 'STRIKETHROUGH')
      lines.push('text-decoration: line-through;');
    if (t.case === 'UPPER') lines.push('text-transform: uppercase;');
    if (t.case === 'LOWER') lines.push('text-transform: lowercase;');
  }
  const al = info.autoLayout;
  if (al) {
    lines.push(
      'display: flex;',
      `flex-direction: ${al.mode === 'VERTICAL' ? 'column' : 'row'};`
    );
    if (al.spacing) lines.push(`gap: ${px(al.spacing)};`);
    const pad = [
      al.paddingTop,
      al.paddingRight,
      al.paddingBottom,
      al.paddingLeft,
    ];
    if (pad.some((p) => p !== 0))
      lines.push(`padding: ${pad.map(px).join(' ')};`);
    if (al.wrap) lines.push('flex-wrap: wrap;');
  }
  return lines;
}

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra ?light|ultra ?light/i, 200],
  [/semi ?bold|demi ?bold/i, 600],
  [/extra ?bold|ultra ?bold/i, 800],
  [/black|heavy/i, 900],
  [/light/i, 300],
  [/medium/i, 500],
  [/bold/i, 700],
];

export function fontWeight(style: string | null): number | undefined {
  if (!style) return undefined;
  for (const [re, w] of WEIGHTS) if (re.test(style)) return w;
  return /regular|normal|book|italic/i.test(style) ? 400 : undefined;
}
