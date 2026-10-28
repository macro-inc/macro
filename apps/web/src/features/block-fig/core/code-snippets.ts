/**
 * Code for a layer in Dev Mode's languages besides CSS (`css.ts`):
 * Tailwind classes, SwiftUI, and Jetpack Compose. Like Figma's, these are
 * starting points covering size, fills, borders, radius, shadows, opacity,
 * auto layout, and type, not complete components.
 */

import type { EffectInfo, NodeInfo, PaintInfo } from '@core/fig-engine/types';
import { match } from 'ts-pattern';
import { cssColor, cssFor, fontWeight } from './css';

export type CodeLanguage = 'css' | 'tailwind' | 'swiftui' | 'compose';

export const CODE_LANGUAGES: { id: CodeLanguage; label: string }[] = [
  { id: 'css', label: 'CSS' },
  { id: 'tailwind', label: 'Tailwind' },
  { id: 'swiftui', label: 'SwiftUI' },
  { id: 'compose', label: 'Compose' },
];

const round = (v: number) => Math.round(v * 100) / 100;

/** The first visible solid paint, as `RRGGBB` and alpha. */
function solid(
  paints: PaintInfo[]
): { hex: string; alpha: number } | undefined {
  const p = [...paints]
    .reverse()
    .find((p) => p.visible && p.type === 'SOLID' && p.color);
  if (!p?.color) return undefined;
  return { hex: p.color, alpha: (p.alpha ?? 1) * p.opacity };
}

function shadow(info: NodeInfo): EffectInfo | undefined {
  return info.effects.find(
    (e) => e.visible && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW')
  );
}

function uniformRadius(info: NodeInfo): number | 'mixed' | undefined {
  const r = info.cornerRadius;
  if (!r) return undefined;
  const v = [r.top_left, r.top_right, r.bottom_right, r.bottom_left];
  return v.every((x) => x === v[0]) ? v[0] : 'mixed';
}

const isText = (info: NodeInfo) => info.type === 'TEXT' && !!info.text;

// ---- Tailwind ---------------------------------------------------------------

/** A Tailwind arbitrary value (spaces become underscores). */
const arb = (v: string) => `[${v.replace(/\s+/g, '_')}]`;
const twPx = (v: number) => arb(`${round(v)}px`);

/** Tailwind classes for the layer. */
export function tailwindFor(info: NodeInfo): string[] {
  const out: string[] = [`w-${twPx(info.width)}`, `h-${twPx(info.height)}`];
  const text = isText(info);
  const fill = solid(info.fills);
  if (fill) {
    out.push(`${text ? 'text' : 'bg'}-${arb(cssColor(fill.hex, fill.alpha))}`);
  } else if (!text) {
    const gradient = cssFor(info).find((l) => l.startsWith('background:'));
    if (gradient)
      out.push(`bg-${arb(gradient.slice(12, -1).replace(/, /g, ','))}`);
  }
  const stroke = solid(info.strokes);
  if (stroke && info.strokeWeight) {
    out.push(
      info.strokeWeight === 1 ? 'border' : `border-${twPx(info.strokeWeight)}`,
      `border-${arb(cssColor(stroke.hex, stroke.alpha))}`
    );
    if (info.dashPattern?.length) out.push('border-dashed');
  }
  const r = uniformRadius(info);
  if (typeof r === 'number' && r > 0) {
    out.push(
      r >= Math.min(info.width, info.height) / 2
        ? 'rounded-full'
        : `rounded-${twPx(r)}`
    );
  } else if (r === 'mixed' && info.cornerRadius) {
    const c = info.cornerRadius;
    out.push(
      `rounded-tl-${twPx(c.top_left)}`,
      `rounded-tr-${twPx(c.top_right)}`,
      `rounded-br-${twPx(c.bottom_right)}`,
      `rounded-bl-${twPx(c.bottom_left)}`
    );
  }
  const s = shadow(info);
  if (s) {
    const inset = s.type === 'INNER_SHADOW' ? 'inset ' : '';
    out.push(
      `shadow-${arb(`${inset}${round(s.x)}px ${round(s.y)}px ${round(s.radius)}px ${round(s.spread)}px ${cssColor(s.color, s.alpha)}`)}`
    );
  }
  const blur = info.effects.find((e) => e.visible && e.type === 'LAYER_BLUR');
  if (blur) out.push(`blur-${twPx(blur.radius / 2)}`);
  if (info.opacity < 0.999)
    out.push(`opacity-${arb(String(round(info.opacity)))}`);
  const al = info.autoLayout;
  if (al && (al.mode === 'HORIZONTAL' || al.mode === 'VERTICAL')) {
    out.push('flex', al.mode === 'VERTICAL' ? 'flex-col' : 'flex-row');
    if (al.wrap) out.push('flex-wrap');
    if (al.spacing) out.push(`gap-${twPx(al.spacing)}`);
    const {
      paddingTop: t,
      paddingRight: rr,
      paddingBottom: b,
      paddingLeft: l,
    } = al;
    if (t === b && l === rr && t === l && t > 0) out.push(`p-${twPx(t)}`);
    else {
      if (l === rr && l > 0) out.push(`px-${twPx(l)}`);
      else {
        if (l > 0) out.push(`pl-${twPx(l)}`);
        if (rr > 0) out.push(`pr-${twPx(rr)}`);
      }
      if (t === b && t > 0) out.push(`py-${twPx(t)}`);
      else {
        if (t > 0) out.push(`pt-${twPx(t)}`);
        if (b > 0) out.push(`pb-${twPx(b)}`);
      }
    }
    const justify = match(al.primaryAlign ?? 'MIN')
      .with('CENTER', () => 'justify-center')
      .with('MAX', () => 'justify-end')
      .with('SPACE_BETWEEN', () => 'justify-between')
      .otherwise(() => 'justify-start');
    const items = match(al.counterAlign ?? 'MIN')
      .with('CENTER', () => 'items-center')
      .with('MAX', () => 'items-end')
      .with('BASELINE', () => 'items-baseline')
      .otherwise(() => 'items-start');
    out.push(justify, items);
  }
  const t = info.text;
  if (text && t) {
    if (t.fontFamily) out.push(`font-${arb(`'${t.fontFamily}'`)}`);
    if (t.fontSize) out.push(`text-${twPx(t.fontSize)}`);
    const weight = fontWeight(t.fontStyle);
    if (weight) out.push(`font-${arb(String(weight))}`);
    if (t.fontStyle?.toLowerCase().includes('italic')) out.push('italic');
    if (t.lineHeight && t.lineHeight[1] !== 'RAW') {
      const [v, unit] = t.lineHeight;
      out.push(`leading-${unit === 'PERCENT' ? arb(`${round(v)}%`) : twPx(v)}`);
    }
    if (t.letterSpacing && t.letterSpacing[0] !== 0) {
      const [v, unit] = t.letterSpacing;
      out.push(
        `tracking-${unit === 'PERCENT' ? arb(`${round(v / 100)}em`) : twPx(v)}`
      );
    }
    if (t.alignHorizontal === 'CENTER') out.push('text-center');
    if (t.alignHorizontal === 'RIGHT') out.push('text-right');
    if (t.alignHorizontal === 'JUSTIFIED') out.push('text-justify');
    if (t.decoration === 'UNDERLINE') out.push('underline');
    if (t.decoration === 'STRIKETHROUGH') out.push('line-through');
    if (t.case === 'UPPER') out.push('uppercase');
    if (t.case === 'LOWER') out.push('lowercase');
  }
  return out;
}

// ---- SwiftUI ----------------------------------------------------------------

function swiftColor(hex: string, alpha = 1): string {
  const n = Number.parseInt(hex, 16);
  const c = (v: number) => round(v / 255);
  const rgb = `red: ${c((n >> 16) & 255)}, green: ${c((n >> 8) & 255)}, blue: ${c(n & 255)}`;
  return alpha < 0.999
    ? `Color(${rgb}).opacity(${round(alpha)})`
    : `Color(${rgb})`;
}

function swiftWeight(style: string | null): string | undefined {
  const w = fontWeight(style);
  return match(w)
    .with(100, () => '.thin')
    .with(200, () => '.ultraLight')
    .with(300, () => '.light')
    .with(500, () => '.medium')
    .with(600, () => '.semibold')
    .with(700, () => '.bold')
    .with(800, () => '.heavy')
    .with(900, () => '.black')
    .otherwise(() => undefined);
}

const swiftString = (s: string) =>
  `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

/** A SwiftUI view for the layer. */
export function swiftUIFor(info: NodeInfo): string[] {
  const lines: string[] = [];
  const mod = (m: string) => lines.push(`  ${m}`);
  const t = info.text;
  if (isText(info) && t) {
    lines.push(`Text(${swiftString(t.characters)})`);
    const weight = swiftWeight(t.fontStyle);
    const font = `.custom(${swiftString(t.fontFamily ?? 'Inter')}, size: ${round(t.fontSize ?? 12)})`;
    mod(`.font(${font}${weight ? `.weight(${weight})` : ''})`);
    if (t.fontStyle?.toLowerCase().includes('italic')) mod('.italic()');
    if (t.alignHorizontal === 'CENTER') mod('.multilineTextAlignment(.center)');
    if (t.alignHorizontal === 'RIGHT')
      mod('.multilineTextAlignment(.trailing)');
    if (t.letterSpacing && t.letterSpacing[0] !== 0) {
      const [v, unit] = t.letterSpacing;
      const pt = unit === 'PERCENT' ? (v / 100) * (t.fontSize ?? 12) : v;
      mod(`.kerning(${round(pt)})`);
    }
    if (t.decoration === 'UNDERLINE') mod('.underline()');
    if (t.decoration === 'STRIKETHROUGH') mod('.strikethrough()');
    const fill = solid(info.fills);
    if (fill) mod(`.foregroundColor(${swiftColor(fill.hex, fill.alpha)})`);
    mod(`.frame(width: ${round(info.width)}, alignment: .topLeading)`);
  } else {
    const al = info.autoLayout;
    const r = uniformRadius(info);
    const shape =
      info.type === 'ELLIPSE'
        ? 'Ellipse()'
        : typeof r === 'number' && r > 0
          ? `RoundedRectangle(cornerRadius: ${round(r)})`
          : 'Rectangle()';
    const fill = solid(info.fills);
    if (al && (al.mode === 'HORIZONTAL' || al.mode === 'VERTICAL')) {
      const stack = al.mode === 'VERTICAL' ? 'VStack' : 'HStack';
      const align = match(al.counterAlign ?? 'MIN')
        .with('CENTER', () => '.center')
        .with('MAX', () => (al.mode === 'VERTICAL' ? '.trailing' : '.bottom'))
        .otherwise(() => (al.mode === 'VERTICAL' ? '.leading' : '.top'));
      lines.push(
        `${stack}(alignment: ${align}, spacing: ${round(al.spacing)}) {`,
        '  // Content',
        '}'
      );
      const pad: [string, number][] = [
        ['.top', al.paddingTop],
        ['.trailing', al.paddingRight],
        ['.bottom', al.paddingBottom],
        ['.leading', al.paddingLeft],
      ];
      for (const [edge, v] of pad)
        if (v > 0) mod(`.padding(${edge}, ${round(v)})`);
      mod(`.frame(width: ${round(info.width)}, height: ${round(info.height)})`);
      if (fill)
        mod(
          `.background(${swiftColor(fill.hex, fill.alpha)}${typeof r === 'number' && r > 0 ? `, in: ${shape}` : ''})`
        );
    } else {
      lines.push(shape);
      if (fill) mod(`.fill(${swiftColor(fill.hex, fill.alpha)})`);
      mod(`.frame(width: ${round(info.width)}, height: ${round(info.height)})`);
    }
    const stroke = solid(info.strokes);
    if (stroke && info.strokeWeight)
      mod(
        `.overlay(${shape}.stroke(${swiftColor(stroke.hex, stroke.alpha)}, lineWidth: ${round(info.strokeWeight)}))`
      );
  }
  const s = shadow(info);
  if (s && s.type === 'DROP_SHADOW')
    mod(
      `.shadow(color: ${swiftColor(s.color, s.alpha)}, radius: ${round(s.radius / 2)}, x: ${round(s.x)}, y: ${round(s.y)})`
    );
  const blur = info.effects.find((e) => e.visible && e.type === 'LAYER_BLUR');
  if (blur) mod(`.blur(radius: ${round(blur.radius / 2)})`);
  if (info.opacity < 0.999) mod(`.opacity(${round(info.opacity)})`);
  if (Math.abs(info.rotation) > 0.01)
    mod(`.rotationEffect(.degrees(${round(-info.rotation)}))`);
  return lines;
}

// ---- Jetpack Compose ----------------------------------------------------------

function composeColor(hex: string, alpha = 1): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
  return `Color(0x${a}${hex.toUpperCase()})`;
}

const kotlinString = (s: string) =>
  `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, '\\n')}"`;

/** A Jetpack Compose composable for the layer. */
export function composeFor(info: NodeInfo): string[] {
  const modifiers: string[] = [];
  const s = shadow(info);
  const r = uniformRadius(info);
  const shapeOf = () =>
    info.type === 'ELLIPSE'
      ? 'CircleShape'
      : typeof r === 'number' && r > 0
        ? `RoundedCornerShape(size = ${round(r)}.dp)`
        : r === 'mixed' && info.cornerRadius
          ? `RoundedCornerShape(topStart = ${round(info.cornerRadius.top_left)}.dp, topEnd = ${round(info.cornerRadius.top_right)}.dp, bottomEnd = ${round(info.cornerRadius.bottom_right)}.dp, bottomStart = ${round(info.cornerRadius.bottom_left)}.dp)`
          : undefined;
  const shape = shapeOf();
  if (s && s.type === 'DROP_SHADOW')
    modifiers.push(
      `.shadow(elevation = ${round(s.radius / 2)}.dp, spotColor = ${composeColor(s.color, s.alpha)}${shape ? `, shape = ${shape}` : ''})`
    );
  if (Math.abs(info.rotation) > 0.01)
    modifiers.push(`.rotate(degrees = ${round(-info.rotation)}f)`);
  modifiers.push(`.width(${round(info.width)}.dp)`);
  if (!isText(info)) modifiers.push(`.height(${round(info.height)}.dp)`);
  if (info.opacity < 0.999) modifiers.push(`.alpha(${round(info.opacity)}f)`);
  const stroke = solid(info.strokes);
  if (stroke && info.strokeWeight)
    modifiers.push(
      `.border(width = ${round(info.strokeWeight)}.dp, color = ${composeColor(stroke.hex, stroke.alpha)}${shape ? `, shape = ${shape}` : ''})`
    );
  const fill = solid(info.fills);
  if (fill && !isText(info))
    modifiers.push(
      `.background(color = ${composeColor(fill.hex, fill.alpha)}${shape ? `, shape = ${shape}` : ''})`
    );
  const al = info.autoLayout;
  const flex = al && (al.mode === 'HORIZONTAL' || al.mode === 'VERTICAL');
  if (flex && al) {
    const p = [
      al.paddingLeft,
      al.paddingTop,
      al.paddingRight,
      al.paddingBottom,
    ];
    if (p.some((v) => v > 0))
      modifiers.push(
        `.padding(start = ${round(p[0])}.dp, top = ${round(p[1])}.dp, end = ${round(p[2])}.dp, bottom = ${round(p[3])}.dp)`
      );
  }
  const modifier = ['modifier = Modifier', ...modifiers.map((m) => `    ${m}`)];
  const t = info.text;
  if (isText(info) && t) {
    const style: string[] = [];
    if (t.fontSize) style.push(`fontSize = ${round(t.fontSize)}.sp`);
    if (t.lineHeight && t.lineHeight[1] === 'PIXELS')
      style.push(`lineHeight = ${round(t.lineHeight[0])}.sp`);
    if (t.fontFamily)
      style.push(
        `fontFamily = FontFamily(Font(R.font.${t.fontFamily.toLowerCase().replace(/[^a-z0-9]+/g, '_')}))`
      );
    const weight = fontWeight(t.fontStyle);
    if (weight) style.push(`fontWeight = FontWeight(${weight})`);
    if (fill) style.push(`color = ${composeColor(fill.hex, fill.alpha)}`);
    if (t.alignHorizontal && t.alignHorizontal !== 'LEFT')
      style.push(
        `textAlign = TextAlign.${match(t.alignHorizontal)
          .with('CENTER', () => 'Center')
          .with('RIGHT', () => 'Right')
          .otherwise(() => 'Justify')}`
      );
    if (t.letterSpacing && t.letterSpacing[0] !== 0) {
      const [v, unit] = t.letterSpacing;
      style.push(
        `letterSpacing = ${unit === 'PERCENT' ? `${round(v / 100)}.em` : `${round(v)}.sp`}`
      );
    }
    return [
      'Text(',
      `  text = ${kotlinString(t.characters)},`,
      ...modifier.map(
        (m, k) => `  ${m}${k === modifier.length - 1 ? ',' : ''}`
      ),
      '  style = TextStyle(',
      ...style.map((s) => `    ${s},`),
      '  )',
      ')',
    ];
  }
  const container = !flex ? 'Box' : al?.mode === 'VERTICAL' ? 'Column' : 'Row';
  const args = modifier.map((m) => `  ${m}`);
  if (flex && al) {
    const horizontal = al.mode === 'HORIZONTAL';
    const arrangement =
      al.primaryAlign === 'SPACE_BETWEEN'
        ? 'Arrangement.SpaceBetween'
        : `Arrangement.spacedBy(${round(al.spacing)}.dp, Alignment.${match(
            al.primaryAlign ?? 'MIN'
          )
            .with('CENTER', () =>
              horizontal ? 'CenterHorizontally' : 'CenterVertically'
            )
            .with('MAX', () => (horizontal ? 'End' : 'Bottom'))
            .otherwise(() => (horizontal ? 'Start' : 'Top'))})`;
    const alignment = match(al.counterAlign ?? 'MIN')
      .with('CENTER', () =>
        horizontal ? 'CenterVertically' : 'CenterHorizontally'
      )
      .with('MAX', () => (horizontal ? 'Bottom' : 'End'))
      .otherwise(() => (horizontal ? 'Top' : 'Start'));
    args[args.length - 1] += ',';
    args.push(
      `  ${horizontal ? 'horizontalArrangement' : 'verticalArrangement'} = ${arrangement},`,
      `  ${horizontal ? 'verticalAlignment' : 'horizontalAlignment'} = Alignment.${alignment},`
    );
  }
  return [`${container}(`, ...args, ') {', '  // Content', '}'];
}

/** The layer's code in `language`. */
export function codeFor(info: NodeInfo, language: CodeLanguage): string {
  return match(language)
    .with('css', () => cssFor(info).join('\n'))
    .with('tailwind', () => tailwindFor(info).join(' '))
    .with('swiftui', () => swiftUIFor(info).join('\n'))
    .with('compose', () => composeFor(info).join('\n'))
    .exhaustive();
}
