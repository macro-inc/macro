import {
  ARROW_ENDS,
  LINE_DASHES,
  MAX_SHAPE_PARTS,
  MAX_SHAPE_SOURCE_LENGTH,
  type ShapeLine,
  type ShapeParagraph,
  type ShapePart,
  type ShapeRun,
  type ShapeText,
  type SheetShape,
} from '@macro-inc/spreadsheet/sheet-drawings';
import type { SaxesTagNS } from 'saxes';
import {
  DEFAULT_THEME,
  finishColor,
  type PendingColor,
  resolveSchemeColors,
  schemeColor,
} from './drawingml-colors';

/** Excel shapes, text boxes, lines, groups and SmartArt, as Macro draws them. */

const XDR =
  'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const RELATIONSHIPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const COMPATIBILITY =
  'http://schemas.openxmlformats.org/markup-compatibility/2006';
/** SmartArt's drawing of its shapes. */
export const DIAGRAM_DRAWING =
  'http://schemas.microsoft.com/office/drawing/2008/diagram';
const EMU_PER_PIXEL = 9525;

/** An element of a shape, kept as a tree while a drawing part is read. */
export type XmlElement = {
  uri: string;
  prefix: string;
  local: string;
  attributes: { uri: string; prefix: string; local: string; value: string }[];
  children: (XmlElement | string)[];
};

/** Collects one element and its descendants from parser events. */
export function elementBuilder() {
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  return {
    get open() {
      return stack.length > 0;
    },
    start(node: SaxesTagNS) {
      const element: XmlElement = {
        uri: node.uri,
        prefix: node.prefix,
        local: node.local,
        attributes: Object.values(node.attributes)
          // Namespace declarations are written again on export.
          .filter(
            (attribute) =>
              attribute.prefix !== 'xmlns' && attribute.name !== 'xmlns'
          )
          .map((attribute) => ({
            uri: attribute.uri,
            prefix: attribute.prefix,
            local: attribute.local,
            value: attribute.value,
          })),
        children: [],
      };
      stack.at(-1)?.children.push(element);
      root ??= element;
      stack.push(element);
    },
    text(chunk: string) {
      const parent = stack.at(-1);
      if (!parent) return;
      const last = parent.children.at(-1);
      if (typeof last === 'string')
        parent.children[parent.children.length - 1] = last + chunk;
      else parent.children.push(chunk);
    },
    /** Close an element; returns the tree when its root closes. */
    end(): XmlElement | undefined {
      stack.pop();
      return stack.length ? undefined : root;
    },
  };
}

const elements = (element: XmlElement | undefined): XmlElement[] =>
  (element?.children ?? []).flatMap((child) =>
    typeof child === 'string'
      ? []
      : // Newer content's fallback is read in its place.
        child.uri === COMPATIBILITY && child.local === 'AlternateContent'
        ? elements(child.children.find(isFallback) as XmlElement | undefined)
        : [child]
  );
const isFallback = (child: XmlElement | string) =>
  typeof child !== 'string' &&
  child.uri === COMPATIBILITY &&
  child.local === 'Fallback';
const child = (element: XmlElement | undefined, local: string) =>
  elements(element).find((value) => value.local === local);
const attribute = (element: XmlElement | undefined, local: string) =>
  element?.attributes.find((value) => value.local === local && !value.uri)
    ?.value;
const number = (value: string | undefined, fallback = 0) => {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : fallback;
};
const isTrue = (value: string | undefined) => value === '1' || value === 'true';
const textOf = (element: XmlElement): string =>
  element.children
    .map((value) => (typeof value === 'string' ? value : textOf(value)))
    .join('');

// Colors --------------------------------------------------------------------

/** Named colors DrawingML's `prstClr` uses most. */
const PRESET_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  gray: '808080',
  grey: '808080',
  darkGray: 'A9A9A9',
  lightGray: 'D3D3D3',
  orange: 'FFA500',
  purple: '800080',
  navy: '000080',
  darkBlue: '00008B',
  darkRed: '8B0000',
  darkGreen: '006400',
  cyan: '00FFFF',
  magenta: 'FF00FF',
};

type Color = {
  /** #RRGGBB; none for the theme's text color. */
  hex?: string;
  alpha?: number;
};

/**
 * The color of a fill or line element's color child. `placeholder` is the
 * color a style reference supplies for `phClr`.
 */
function readColor(
  element: XmlElement | undefined,
  theme: (string | undefined)[],
  placeholder?: Color
): Color | undefined {
  const value = elements(element).find((entry) =>
    [
      'srgbClr',
      'schemeClr',
      'sysClr',
      'prstClr',
      'scrgbClr',
      'hslClr',
    ].includes(entry.local)
  );
  if (!value) return;
  const modifiers = elements(value).map((entry): [string, number] => [
    entry.local,
    number(attribute(entry, 'val')),
  ]);
  const alphaModifier = modifiers.find(([name]) => name === 'alpha');
  const alpha = alphaModifier ? alphaModifier[1] / 100_000 : undefined;
  const pending: PendingColor = {
    modifiers: modifiers.filter(([name]) => name !== 'alpha'),
  };
  const scheme = attribute(value, 'val');
  if (value.local === 'srgbClr') pending.hex = scheme;
  else if (value.local === 'sysClr') pending.hex = attribute(value, 'lastClr');
  else if (value.local === 'prstClr') pending.hex = PRESET_COLORS[scheme ?? ''];
  else if (value.local === 'scrgbClr')
    pending.hex = ['r', 'g', 'b']
      .map((channel) =>
        Math.round(
          Math.max(
            0,
            Math.min(1, number(attribute(value, channel)) / 100_000)
          ) * 255
        )
          .toString(16)
          .padStart(2, '0')
      )
      .join('');
  else if (value.local === 'schemeClr') {
    if (scheme === 'phClr') {
      if (!placeholder) return;
      // The style's color with this element's modifiers.
      if (!placeholder.hex || !pending.modifiers.length)
        return { ...placeholder, ...(alpha !== undefined && { alpha }) };
      pending.hex = placeholder.hex.slice(1);
    } else {
      // The theme's text color follows the app's theme, unless modified.
      if ((scheme === 'tx1' || scheme === 'dk1') && !pending.modifiers.length)
        return { ...(alpha !== undefined && { alpha }) };
      pending.hex = schemeColor(theme, scheme ?? '') ?? DEFAULT_THEME[1];
    }
  } else return;
  if (!pending.hex || !/^[0-9a-f]{6}$/i.test(pending.hex)) return;
  const hex = finishColor(pending);
  return hex ? { hex, ...(alpha !== undefined && { alpha }) } : undefined;
}

// Geometry ------------------------------------------------------------------

type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  /** A group's own coordinates, which its members are placed in. */
  child?: { x: number; y: number; width: number; height: number };
};

function readFrame(xfrm: XmlElement | undefined): Frame | undefined {
  if (!xfrm) return;
  const off = child(xfrm, 'off');
  const ext = child(xfrm, 'ext');
  const chOff = child(xfrm, 'chOff');
  const chExt = child(xfrm, 'chExt');
  const rotation = number(attribute(xfrm, 'rot')) / 60_000;
  return {
    x: number(attribute(off, 'x')),
    y: number(attribute(off, 'y')),
    width: Math.max(0, number(attribute(ext, 'cx'))),
    height: Math.max(0, number(attribute(ext, 'cy'))),
    ...(rotation && { rotation }),
    ...(isTrue(attribute(xfrm, 'flipH')) && { flipH: true }),
    ...(isTrue(attribute(xfrm, 'flipV')) && { flipV: true }),
    ...((chOff || chExt) && {
      child: {
        x: number(attribute(chOff, 'x')),
        y: number(attribute(chOff, 'y')),
        width: number(attribute(chExt, 'cx')),
        height: number(attribute(chExt, 'cy')),
      },
    }),
  };
}

/** Bézier segments of an elliptical arc, as DrawingML's `arcTo` draws it. */
function arcCurves(
  start: [number, number],
  radiusX: number,
  radiusY: number,
  startAngle: number,
  sweepAngle: number
): { curves: [number, number][][]; end: [number, number] } {
  // Angles are of the circle the ellipse is stretched from.
  const parametric = (angle: number) =>
    Math.atan2(radiusX * Math.sin(angle), radiusY * Math.cos(angle));
  const from = parametric(startAngle);
  const to = from + (parametric(startAngle + sweepAngle) - from || 0);
  let sweep = to - from;
  // Keep the sweep's direction and size.
  if (sweepAngle > 0 && sweep <= 0) sweep += 2 * Math.PI;
  if (sweepAngle < 0 && sweep >= 0) sweep -= 2 * Math.PI;
  if (Math.abs(sweepAngle) >= 2 * Math.PI)
    sweep = Math.sign(sweepAngle) * 2 * Math.PI;
  const center: [number, number] = [
    start[0] - radiusX * Math.cos(from),
    start[1] - radiusY * Math.sin(from),
  ];
  const at = (angle: number): [number, number] => [
    center[0] + radiusX * Math.cos(angle),
    center[1] + radiusY * Math.sin(angle),
  ];
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const step = sweep / segments;
  const handle = (4 / 3) * Math.tan(step / 4);
  const curves: [number, number][][] = [];
  for (let index = 0; index < segments; index++) {
    const a = from + step * index;
    const b = a + step;
    const p0 = at(a);
    const p3 = at(b);
    curves.push([
      [
        p0[0] - handle * radiusX * Math.sin(a),
        p0[1] + handle * radiusY * Math.cos(a),
      ],
      [
        p3[0] + handle * radiusX * Math.sin(b),
        p3[1] - handle * radiusY * Math.cos(b),
      ],
      p3,
    ]);
  }
  return { curves, end: at(from + sweep) };
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** A custom outline's paths, as SVG paths in a box from 0 to 1. */
function customPaths(geometry: XmlElement): ShapePart['paths'] {
  const result: NonNullable<ShapePart['paths']> = [];
  for (const path of elements(child(geometry, 'pathLst'))) {
    if (path.local !== 'path' || result.length >= 32) continue;
    const width = number(attribute(path, 'w'));
    const height = number(attribute(path, 'h'));
    // Paths without their own size use the shape's box.
    const scaleX = width > 0 ? 1 / width : 0;
    const scaleY = height > 0 ? 1 / height : 0;
    const point = (element: XmlElement): [number, number] => [
      number(attribute(element, 'x')),
      number(attribute(element, 'y')),
    ];
    const text = (value: [number, number]) =>
      `${round(scaleX ? value[0] * scaleX : 0)},${round(scaleY ? value[1] * scaleY : 0)}`;
    let current: [number, number] = [0, 0];
    let start: [number, number] = [0, 0];
    const commands: string[] = [];
    for (const command of elements(path)) {
      const points = elements(command)
        .filter((entry) => entry.local === 'pt')
        .map(point);
      if (command.local === 'moveTo' && points[0]) {
        current = start = points[0];
        commands.push(`M${text(current)}`);
      } else if (command.local === 'lnTo' && points[0]) {
        current = points[0];
        commands.push(`L${text(current)}`);
      } else if (command.local === 'cubicBezTo' && points.length === 3) {
        current = points[2];
        commands.push(`C${points.map(text).join(' ')}`);
      } else if (command.local === 'quadBezTo' && points.length === 2) {
        current = points[1];
        commands.push(`Q${points.map(text).join(' ')}`);
      } else if (command.local === 'arcTo') {
        const arc = arcCurves(
          current,
          number(attribute(command, 'wR')),
          number(attribute(command, 'hR')),
          (number(attribute(command, 'stAng')) / 60_000) * (Math.PI / 180),
          (number(attribute(command, 'swAng')) / 60_000) * (Math.PI / 180)
        );
        for (const curve of arc.curves)
          commands.push(`C${curve.map(text).join(' ')}`);
        current = arc.end;
      } else if (command.local === 'close') {
        current = start;
        commands.push('Z');
      }
    }
    const d = commands.join('');
    if (!d || d.length > 100_000) continue;
    result.push({
      d,
      ...(attribute(path, 'fill') === 'none' && { fill: false as const }),
      ...(attribute(path, 'stroke') === 'false' ||
      attribute(path, 'stroke') === '0'
        ? { stroke: false as const }
        : {}),
    });
  }
  return result.length ? result : undefined;
}

// Style references ----------------------------------------------------------

/** Line widths of a theme's line styles, by `lnRef` index; Office's. */
const LINE_STYLE_WIDTHS = [6350, 12700, 19050];

type ShapeStyle = {
  fill?: Color;
  line?: { color?: Color; width: number };
  font?: Color;
};

function readStyle(
  element: XmlElement | undefined,
  theme: (string | undefined)[]
): ShapeStyle {
  if (!element) return {};
  const fillRef = child(element, 'fillRef');
  const lineRef = child(element, 'lnRef');
  const fontRef = child(element, 'fontRef');
  const fillIndex = number(attribute(fillRef, 'idx'));
  const lineIndex = number(attribute(lineRef, 'idx'));
  // A placeholder color stands for the reference's own color.
  const color = (reference: XmlElement | undefined) =>
    readColor(reference, theme, { hex: '#000000' });
  return {
    ...(fillIndex > 0 && { fill: color(fillRef) }),
    ...(lineIndex > 0 && {
      line: {
        color: color(lineRef),
        width:
          LINE_STYLE_WIDTHS[Math.min(lineIndex, LINE_STYLE_WIDTHS.length) - 1],
      },
    }),
    ...(fontRef && { font: color(fontRef) }),
  };
}

// Fills and lines -------------------------------------------------------------

/** A shape's fill, from its properties or else its style. */
function readFill(
  properties: XmlElement | undefined,
  style: ShapeStyle,
  theme: (string | undefined)[]
): Color | undefined {
  for (const entry of elements(properties)) {
    if (entry.local === 'noFill') return;
    if (entry.local === 'solidFill') return readColor(entry, theme, style.fill);
    if (entry.local === 'gradFill') {
      // A gradient is drawn in its middle color.
      const stops = elements(child(entry, 'gsLst'));
      return readColor(
        stops[Math.floor((stops.length - 1) / 2)],
        theme,
        style.fill
      );
    }
    if (entry.local === 'pattFill')
      return readColor(child(entry, 'fgClr'), theme, style.fill);
    if (entry.local === 'blipFill') return { hex: '#D9D9D9' };
    if (entry.local === 'grpFill') return;
  }
  return style.fill;
}

const DASHES: Record<string, ShapeLine['dash']> = {
  dash: 'dash',
  sysDash: 'dash',
  dot: 'dot',
  sysDot: 'dot',
  dashDot: 'dashDot',
  sysDashDot: 'dashDot',
  lgDash: 'longDash',
  lgDashDot: 'longDashDot',
  lgDashDotDot: 'longDashDot',
  sysDashDotDot: 'dashDot',
};

function readLine(
  properties: XmlElement | undefined,
  style: ShapeStyle,
  theme: (string | undefined)[]
): ShapeLine | undefined {
  const line = child(properties, 'ln');
  let color: Color | undefined = style.line?.color;
  let visible = !!style.line;
  for (const entry of elements(line)) {
    if (entry.local === 'noFill') visible = false;
    else if (entry.local === 'solidFill') {
      color = readColor(entry, theme, style.line?.color);
      visible = true;
    } else if (entry.local === 'gradFill') {
      color = readColor(
        elements(child(entry, 'gsLst'))[0],
        theme,
        style.line?.color
      );
      visible = true;
    }
  }
  if (!visible) return;
  const width = number(attribute(line, 'w'), style.line?.width ?? 9525);
  const dash = DASHES[attribute(child(line, 'prstDash'), 'val') ?? ''];
  const end = (local: 'headEnd' | 'tailEnd') => {
    const type = attribute(child(line, local), 'type');
    return (ARROW_ENDS as readonly string[]).includes(type ?? '')
      ? (type as ShapeLine['head'])
      : undefined;
  };
  const head = end('headEnd');
  const tail = end('tailEnd');
  return {
    ...(color?.hex && { color: color.hex }),
    width: Math.min(200, Math.round((width / EMU_PER_PIXEL) * 100) / 100),
    ...(dash && (LINE_DASHES as readonly string[]).includes(dash) && { dash }),
    ...(head && { head }),
    ...(tail && { tail }),
  };
}

// Text ------------------------------------------------------------------------

const ALIGNMENTS: Record<string, ShapeParagraph['align']> = {
  l: 'left',
  ctr: 'center',
  r: 'right',
  just: 'justify',
  dist: 'justify',
};

type RunDefaults = Omit<ShapeRun, 'text'>;

function readRunProperties(
  properties: XmlElement | undefined,
  defaults: RunDefaults,
  theme: (string | undefined)[]
): RunDefaults {
  if (!properties) return defaults;
  const result: RunDefaults = { ...defaults };
  const size = attribute(properties, 'sz');
  if (size !== undefined) {
    const points = number(size) / 100;
    if (points >= 1 && points <= 400) result.size = points;
  }
  const flag = (local: string, key: 'bold' | 'italic') => {
    const value = attribute(properties, local);
    if (value === undefined) return;
    if (isTrue(value)) result[key] = true;
    else delete result[key];
  };
  flag('b', 'bold');
  flag('i', 'italic');
  const underline = attribute(properties, 'u');
  if (underline !== undefined) {
    if (underline !== 'none') result.underline = true;
    else delete result.underline;
  }
  const strike = attribute(properties, 'strike');
  if (strike !== undefined) {
    if (strike !== 'noStrike') result.strike = true;
    else delete result.strike;
  }
  const fill = child(properties, 'solidFill');
  if (fill) {
    const color = readColor(fill, theme);
    if (color?.hex) result.color = color.hex;
    else delete result.color;
  }
  const font = attribute(child(properties, 'latin'), 'typeface');
  // Theme fonts (`+mn-lt`) are the sheet's own font.
  if (font && !font.startsWith('+')) result.font = font.slice(0, 100);
  return result;
}

/** A shape's text body, or undefined when it has no text. */
function readText(
  body: XmlElement | undefined,
  style: ShapeStyle,
  theme: (string | undefined)[],
  link: string | undefined
): ShapeText | undefined {
  if (!body && !link) return;
  const bodyProperties = child(body, 'bodyPr');
  const listDefaults = child(
    child(child(body, 'lstStyle'), 'lvl1pPr'),
    'defRPr'
  );
  let defaults: RunDefaults = {
    ...(style.font?.hex && { color: style.font.hex }),
  };
  defaults = readRunProperties(listDefaults, defaults, theme);
  const paragraphs: ShapeParagraph[] = [];
  let characters = 0;
  for (const paragraph of elements(body)) {
    if (paragraph.local !== 'p' || paragraphs.length >= 1_000) continue;
    const properties = child(paragraph, 'pPr');
    const paragraphDefaults = readRunProperties(
      child(properties, 'defRPr'),
      defaults,
      theme
    );
    const runs: ShapeRun[] = [];
    for (const run of elements(paragraph)) {
      if (runs.length >= 1_000) break;
      let text: string | undefined;
      if (run.local === 'r' || run.local === 'fld') {
        const characters = child(run, 't');
        text = characters ? textOf(characters) : '';
      } else if (run.local === 'br') text = '\n';
      if (text === undefined) continue;
      text = text.slice(0, Math.max(0, 32_767 - characters));
      characters += text.length;
      const look = readRunProperties(
        child(run, 'rPr'),
        paragraphDefaults,
        theme
      );
      const previous = runs.at(-1);
      // Runs that look the same are one run.
      if (previous && sameLook(previous, look)) previous.text += text;
      else runs.push({ text, ...look });
    }
    const align = ALIGNMENTS[attribute(properties, 'algn') ?? ''];
    const end = readRunProperties(
      child(paragraph, 'endParaRPr'),
      paragraphDefaults,
      theme
    );
    paragraphs.push({
      ...(align && align !== 'left' && { align }),
      runs: runs.filter((run) => run.text),
      ...(!runs.some((run) => run.text) && { size: end.size ?? 11 }),
    });
  }
  // Trailing empty paragraphs take no room in Excel's text boxes either way.
  while (paragraphs.length > 1 && !paragraphs.at(-1)?.runs.length && !link)
    paragraphs.pop();
  if (!link && !paragraphs.some((paragraph) => paragraph.runs.length)) return;
  const inset = (local: string, fallback: number) =>
    Math.round(
      number(attribute(bodyProperties, local), fallback) / EMU_PER_PIXEL
    );
  const anchor = attribute(bodyProperties, 'anchor');
  const vertical = attribute(bodyProperties, 'vert');
  const insets: [number, number, number, number] = [
    inset('lIns', 91_440),
    inset('tIns', 45_720),
    inset('rIns', 91_440),
    inset('bIns', 45_720),
  ];
  return {
    paragraphs,
    ...(anchor === 'ctr' && { anchor: 'middle' as const }),
    ...(anchor === 'b' && { anchor: 'bottom' as const }),
    insets,
    ...(attribute(bodyProperties, 'wrap') === 'none' && { noWrap: true }),
    ...(['clip', 'ellipsis'].includes(
      attribute(bodyProperties, 'vertOverflow') ?? ''
    ) && { clip: true }),
    ...((vertical === 'vert' || vertical === 'eaVert') && {
      vertical: 'down' as const,
    }),
    ...(vertical === 'vert270' && { vertical: 'up' as const }),
    ...(link && { link: link.slice(0, 1_000) }),
  };
}

const sameLook = (a: RunDefaults, b: RunDefaults) =>
  (
    ['bold', 'italic', 'underline', 'strike', 'size', 'color', 'font'] as const
  ).every((key) => a[key] === b[key]);

// Shapes ----------------------------------------------------------------------

/** Maps a group's member coordinates into the drawing's. */
type Placement = (frame: Frame) => Frame;

const identity: Placement = (frame) => frame;

function groupPlacement(group: Frame, outer: Placement): Placement {
  const space = group.child;
  if (!space || !space.width || !space.height) return outer;
  const scaleX = group.width / space.width;
  const scaleY = group.height / space.height;
  return (frame) =>
    outer({
      ...frame,
      x: group.x + (frame.x - space.x) * scaleX,
      y: group.y + (frame.y - space.y) * scaleY,
      width: frame.width * scaleX,
      height: frame.height * scaleY,
    });
}

type ReadPart = Omit<ShapePart, 'x' | 'y' | 'width' | 'height'> & {
  frame: Frame;
};

const PROPERTIES = ['spPr'];

function readParts(
  element: XmlElement,
  theme: (string | undefined)[],
  place: Placement,
  parts: ReadPart[]
) {
  if (parts.length >= MAX_SHAPE_PARTS) return;
  if (element.local === 'grpSp' || element.local === 'spTree') {
    const frame = readFrame(child(child(element, 'grpSpPr'), 'xfrm'));
    const inner = frame ? groupPlacement(frame, place) : place;
    for (const member of elements(element))
      if (
        ['sp', 'cxnSp', 'grpSp', 'pic', 'graphicFrame'].includes(member.local)
      )
        readParts(member, theme, inner, parts);
    return;
  }
  const properties = elements(element).find((entry) =>
    PROPERTIES.includes(entry.local)
  );
  // A shape without a frame fills its anchor; a member without one is lost.
  const frame =
    readFrame(child(properties, 'xfrm')) ??
    (place === identity ? { x: 0, y: 0, width: 1, height: 1 } : undefined);
  if (!frame) return;
  const style = readStyle(child(element, 'style'), theme);
  const preset = child(properties, 'prstGeom');
  const custom = child(properties, 'custGeom');
  const geometry = preset
    ? (attribute(preset, 'prst') ?? 'rect')
    : custom
      ? 'custom'
      : element.local === 'cxnSp'
        ? 'line'
        : 'rect';
  const adjust: Record<string, number> = {};
  for (const guide of elements(child(preset, 'avLst'))) {
    const name = attribute(guide, 'name') ?? '';
    const value = /^val\s+(-?\d+(?:\.\d+)?)$/.exec(
      attribute(guide, 'fmla') ?? ''
    );
    if (
      guide.local === 'gd' &&
      value &&
      /^[A-Za-z]{1,8}\d{0,2}$/.test(name) &&
      Object.keys(adjust).length < 8
    )
      adjust[name] = Math.max(
        -10_000_000,
        Math.min(10_000_000, Number(value[1]))
      );
  }
  const paths = custom ? customPaths(custom) : undefined;
  // Pictures in groups are drawn as their frames.
  const fill =
    element.local === 'pic'
      ? { hex: '#D9D9D9' }
      : element.local === 'cxnSp'
        ? undefined
        : readFill(properties, style, theme);
  const line = readLine(properties, style, theme);
  const link = attribute(element, 'textlink')?.replace(/^=/, '').trim();
  const text = readText(
    child(element, 'txBody'),
    style,
    theme,
    link || undefined
  );
  const placed = place(frame);
  parts.push({
    frame: placed,
    ...(geometry !== 'rect' &&
      /^[A-Za-z0-9]{1,40}$/.test(geometry) && { geometry }),
    ...(Object.keys(adjust).length && { adjust }),
    ...(paths && { paths }),
    ...(frame.rotation && { rotation: ((frame.rotation % 360) + 360) % 360 }),
    ...(frame.flipH && { flipH: true }),
    ...(frame.flipV && { flipV: true }),
    ...(fill?.hex && { fill: fill.hex }),
    ...(fill?.hex &&
      fill.alpha !== undefined &&
      fill.alpha < 1 && {
        opacity: Math.max(0, Math.round(fill.alpha * 100) / 100),
      }),
    ...(line && { line }),
    ...(text && { text }),
  });
  // SmartArt places some text apart from its shape.
  const textFrame = readFrame(child(element, 'txXfrm'));
  const last = parts.at(-1);
  if (textFrame && last?.text) {
    const { text: shapeText, ...shape } = last;
    parts[parts.length - 1] = shape;
    parts.push({ frame: place(textFrame), text: shapeText });
  }
}

/**
 * The parts of a shape element (`sp`, `cxnSp` or `grpSp`, or SmartArt's
 * `spTree`), placed as fractions of `bounds`: the drawing's frame in the
 * element's coordinates, or by default the element's own frame.
 */
export function readShape(
  element: XmlElement,
  theme: (string | undefined)[],
  bounds?: { x: number; y: number; width: number; height: number }
): SheetShape | undefined {
  const parts: ReadPart[] = [];
  readParts(element, theme, identity, parts);
  if (!parts.length) return;
  let box = bounds;
  if (!box || box.width <= 0 || box.height <= 0) {
    const own =
      element.local === 'grpSp'
        ? readFrame(child(child(element, 'grpSpPr'), 'xfrm'))
        : parts.length === 1
          ? parts[0].frame
          : undefined;
    // A straight line may have no height or no width.
    if (own && (own.width > 0 || own.height > 0)) box = own;
    else {
      const left = Math.min(...parts.map((part) => part.frame.x));
      const top = Math.min(...parts.map((part) => part.frame.y));
      box = {
        x: left,
        y: top,
        width:
          Math.max(...parts.map((part) => part.frame.x + part.frame.width)) -
            left || 1,
        height:
          Math.max(...parts.map((part) => part.frame.y + part.frame.height)) -
            top || 1,
      };
    }
  }
  const scale = (value: number, size: number) =>
    round(Math.max(-100, Math.min(100, size ? value / size : 0)));
  return {
    parts: parts.map(({ frame, ...part }) => ({
      x: scale(frame.x - box.x, box.width),
      y: scale(frame.y - box.y, box.height),
      width: scale(frame.width, box.width),
      height: scale(frame.height, box.height),
      ...part,
    })),
  };
}

/** The name Excel gives a shape element, as in its selection pane. */
export function shapeName(element: XmlElement | undefined): string | undefined {
  const properties = elements(element).find((entry) =>
    ['nvSpPr', 'nvCxnSpPr', 'nvGrpSpPr'].includes(entry.local)
  );
  return attribute(child(properties, 'cNvPr'), 'name') || undefined;
}

// Export of kept shapes -------------------------------------------------------

const KNOWN_PREFIXES: Record<string, string> = {
  [XDR]: 'xdr',
  [DRAWING]: 'a',
  [RELATIONSHIPS]: 'r',
  [COMPATIBILITY]: 'mc',
};

/** Scheme colors that stay theme colors in kept shapes. */
const THEME_TEXT = new Set(['tx1', 'dk1']);

const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value: string) =>
  escapeText(value).replace(/"/g, '&quot;');

/**
 * A shape element as XML that stands alone: namespaces declared on it,
 * newer content replaced by its fallback, and links to other parts
 * (hyperlinks, picture fills) left out, since the download has no such
 * parts. Theme colors become the colors they were, but the theme's text
 * color, which follows the theme. `rename` moves elements of one namespace
 * into another, as SmartArt's shapes become a group of ordinary shapes.
 * Undefined when the result is too large to keep.
 */
export function shapeSource(
  element: XmlElement,
  theme: (string | undefined)[],
  rename?: { from: string; to: string; drop?: string[] }
): string | undefined {
  const prefixes = new Map<string, string>();
  const used = new Set<string>();
  const prefixOf = (uri: string, preferred: string) => {
    let prefix = prefixes.get(uri);
    if (prefix !== undefined) return prefix;
    prefix =
      KNOWN_PREFIXES[uri] ??
      (preferred && !used.has(preferred) ? preferred : `ns${prefixes.size}`);
    while (used.has(prefix)) prefix = `${prefix}x`;
    prefixes.set(uri, prefix);
    used.add(prefix);
    return prefix;
  };
  for (const [uri, prefix] of Object.entries(KNOWN_PREFIXES)) {
    prefixes.set(uri, prefix);
    used.add(prefix);
  }
  const declared = new Set<string>();
  const write = (node: XmlElement): string => {
    if (node.uri === COMPATIBILITY && node.local === 'AlternateContent') {
      const fallback = node.children.find(isFallback) as XmlElement | undefined;
      return fallback ? fallback.children.map(content).join('') : '';
    }
    if (
      node.attributes.some((value) => value.uri === RELATIONSHIPS) ||
      rename?.drop?.includes(node.local)
    )
      return '';
    const uri = rename && node.uri === rename.from ? rename.to : node.uri;
    const prefix = uri ? prefixOf(uri, node.prefix) : '';
    if (uri) declared.add(uri);
    const name = prefix ? `${prefix}:${node.local}` : node.local;
    const attributes = node.attributes
      .filter((value) => !(rename && value.local === 'modelId' && !value.uri))
      .map((value) => {
        if (!value.uri)
          return ` ${value.local}="${escapeAttribute(value.value)}"`;
        const attributePrefix = prefixOf(value.uri, value.prefix);
        declared.add(value.uri);
        return ` ${attributePrefix}:${value.local}="${escapeAttribute(value.value)}"`;
      })
      .join('');
    const inner = node.children.map(content).join('');
    return inner
      ? `<${name}${attributes}>${inner}</${name}>`
      : `<${name}${attributes}/>`;
  };
  const content = (node: XmlElement | string) =>
    typeof node === 'string' ? escapeText(node) : write(node);
  const body = write(element);
  const declarations = [...declared]
    .map((uri) => ` xmlns:${prefixes.get(uri)}="${escapeAttribute(uri)}"`)
    .join('');
  const source = normalized(
    resolveSchemeColors(
      body.replace(/^<([\w.:-]+)/, `<$1${declarations}`),
      'a',
      theme,
      THEME_TEXT
    )
  );
  return source.length <= MAX_SHAPE_SOURCE_LENGTH ? source : undefined;
}

/**
 * A kept shape without what export writes anew: its frame's position and
 * size, its shape ids (numbered from 1, connections with them) and an empty
 * text link. Kept shapes then read back from a download unchanged.
 */
function normalized(source: string): string {
  const ids = new Map<string, number>();
  let result = source
    .replace(/^(<xdr:sp\b[^>]*?)\stextlink=""/, '$1')
    .replace(
      /(<xdr:cNvPr\b[^>]*?\bid=")(\d+)(")/g,
      (_, open: string, id: string, close: string) => {
        const next = ids.size + 1;
        if (!ids.has(id)) ids.set(id, next);
        return `${open}${next}${close}`;
      }
    )
    .replace(
      /(<a:(?:stCxn|endCxn)\b[^>]*?\bid=")(\d+)(")/g,
      (_, open: string, id: string, close: string) =>
        `${open}${ids.get(id) ?? 0}${close}`
    );
  const members = result
    .slice(1)
    .search(/<xdr:(?:sp|cxnSp|grpSp|pic|graphicFrame)\b/);
  const end = members < 0 ? result.length : members + 1;
  const xfrm = /<a:xfrm\b[^>]*?(?:\/>|>[\s\S]*?<\/a:xfrm>)/.exec(result);
  if (xfrm && xfrm.index < end)
    result =
      result.slice(0, xfrm.index) +
      xfrm[0].replace(/<a:off\b[^>]*\/>/, '').replace(/<a:ext\b[^>]*\/>/, '') +
      result.slice(xfrm.index + xfrm[0].length);
  return result;
}

/**
 * SmartArt as a group of the shapes Excel drew for it: the diagram's
 * drawing (`dsp:drawing`) and the frame it fills, in EMU.
 */
export function diagramShape(
  drawing: XmlElement,
  frame: { width: number; height: number },
  theme: (string | undefined)[],
  name: string
): SheetShape | undefined {
  const tree = child(drawing, 'spTree');
  if (!tree || frame.width <= 0 || frame.height <= 0) return;
  const shape = readShape(tree, theme, { x: 0, y: 0, ...frame });
  if (!shape) return;
  const members = elements(tree).filter((entry) =>
    ['sp', 'grpSp', 'cxnSp'].includes(entry.local)
  );
  const group: XmlElement = {
    uri: XDR,
    prefix: 'xdr',
    local: 'grpSp',
    attributes: [],
    children: [
      element(
        XDR,
        'nvGrpSpPr',
        [],
        [
          element(XDR, 'cNvPr', [
            ['id', '2'],
            ['name', name],
          ]),
          element(XDR, 'cNvGrpSpPr'),
        ]
      ),
      element(
        XDR,
        'grpSpPr',
        [],
        [
          element(
            DRAWING,
            'xfrm',
            [],
            [
              element(DRAWING, 'off', [
                ['x', '0'],
                ['y', '0'],
              ]),
              element(DRAWING, 'ext', [
                ['cx', String(Math.round(frame.width))],
                ['cy', String(Math.round(frame.height))],
              ]),
              element(DRAWING, 'chOff', [
                ['x', '0'],
                ['y', '0'],
              ]),
              element(DRAWING, 'chExt', [
                ['cx', String(Math.round(frame.width))],
                ['cy', String(Math.round(frame.height))],
              ]),
            ]
          ),
        ]
      ),
      ...members,
    ],
  };
  const source = shapeSource(group, theme, {
    from: DIAGRAM_DRAWING,
    to: XDR,
    drop: ['txXfrm'],
  });
  return { ...shape, ...(source && { source }) };
}

function element(
  uri: string,
  local: string,
  attributes: [string, string][] = [],
  children: XmlElement[] = []
): XmlElement {
  return {
    uri,
    prefix: KNOWN_PREFIXES[uri] ?? '',
    local,
    attributes: attributes.map(([name, value]) => ({
      uri: '',
      prefix: '',
      local: name,
      value,
    })),
    children,
  };
}

// Writing shapes ----------------------------------------------------------------

/** Line presets Excel writes as connectors, which hold no text. */
const CONNECTORS = new Set([
  'line',
  'straightConnector1',
  'bentConnector2',
  'bentConnector3',
  'bentConnector4',
  'bentConnector5',
  'curvedConnector2',
  'curvedConnector3',
  'curvedConnector4',
  'curvedConnector5',
]);

type Box = { x: number; y: number; width: number; height: number };

const emu = (value: number) => Math.round(value);

/**
 * The kept element with its frame placed at `box` (EMU) and its shape ids
 * renumbered for the drawing part; connections to shapes outside it are
 * left out.
 */
function placedSource(source: string, box: Box, nextId: () => number) {
  const ids = new Map<string, number>();
  let result = source.replace(
    /(<xdr:cNvPr\b[^>]*?\bid=")(\d+)(")/g,
    (_, open: string, id: string, close: string) => {
      const next = nextId();
      if (!ids.has(id)) ids.set(id, next);
      return `${open}${next}${close}`;
    }
  );
  result = result.replace(
    /<a:(stCxn|endCxn)\b([^>]*?)\bid="(\d+)"([^>]*?)\/>/g,
    (_, local: string, before: string, id: string, after: string) => {
      const mapped = ids.get(id);
      return mapped === undefined
        ? ''
        : `<a:${local}${before}id="${mapped}"${after}/>`;
    }
  );
  const frame = `<a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.width)}" cy="${emu(box.height)}"/>`;
  // The root's frame is the first, before any member's.
  const members = result
    .slice(1)
    .search(/<xdr:(?:sp|cxnSp|grpSp|pic|graphicFrame)\b/);
  const end = members < 0 ? result.length : members + 1;
  const xfrm = /<a:xfrm\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:xfrm>)/.exec(result);
  if (xfrm && xfrm.index < end) {
    const inner = (xfrm[1] ?? '')
      .replace(/<a:off\b[^>]*\/>/, '')
      .replace(/<a:ext\b[^>]*\/>/, '');
    const open = xfrm[0].replace(/\/?>[\s\S]*$/, '>').replace(/\/>$/, '>');
    return (
      result.slice(0, xfrm.index) +
      `${open}${frame}${inner}</a:xfrm>` +
      result.slice(xfrm.index + xfrm[0].length)
    );
  }
  // A frame where the shape has none.
  return result.replace(
    /<xdr:(spPr|grpSpPr)\b([^>]*?)(\/?)>/,
    (_, local: string, attributes: string, closed: string) =>
      closed
        ? `<xdr:${local}${attributes}><a:xfrm>${frame}</a:xfrm></xdr:${local}>`
        : `<xdr:${local}${attributes}><a:xfrm>${frame}</a:xfrm>`
  );
}

const xmlText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlAttribute = (value: string) => xmlText(value).replace(/"/g, '&quot;');
const hex = (color: string) => color.slice(1).toUpperCase();

/** A unit-box SVG path as a DrawingML path of 100,000 units a side. */
function drawingPath(path: NonNullable<ShapePart['paths']>[number]): string {
  const size = 100_000;
  const tokens = path.d.match(/[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const commands: string[] = [];
  let index = 0;
  const point = () => {
    const x = Number(tokens[index++]);
    const y = Number(tokens[index++]);
    return `<a:pt x="${Math.round(x * size)}" y="${Math.round(y * size)}"/>`;
  };
  while (index < tokens.length) {
    const command = tokens[index++].toUpperCase();
    if (command === 'M') commands.push(`<a:moveTo>${point()}</a:moveTo>`);
    else if (command === 'L') commands.push(`<a:lnTo>${point()}</a:lnTo>`);
    else if (command === 'C')
      commands.push(
        `<a:cubicBezTo>${point()}${point()}${point()}</a:cubicBezTo>`
      );
    else if (command === 'Q')
      commands.push(`<a:quadBezTo>${point()}${point()}</a:quadBezTo>`);
    else if (command === 'Z') commands.push('<a:close/>');
  }
  return `<a:path w="${size}" h="${size}"${path.fill === false ? ' fill="none"' : ''}${path.stroke === false ? ' stroke="0"' : ''}>${commands.join('')}</a:path>`;
}

function textXml(text: ShapeText): string {
  const [left, top, right, bottom] = text.insets ?? [10, 5, 10, 5];
  const anchor =
    text.anchor === 'middle' ? 'ctr' : text.anchor === 'bottom' ? 'b' : 't';
  const vertical =
    text.vertical === 'down'
      ? ' vert="vert"'
      : text.vertical === 'up'
        ? ' vert="vert270"'
        : '';
  const runXml = (run: ShapeRun) => {
    const properties = `<a:rPr lang="en-US"${run.size ? ` sz="${Math.round(run.size * 100)}"` : ''}${run.bold ? ' b="1"' : ''}${run.italic ? ' i="1"' : ''}${run.underline ? ' u="sng"' : ''}${run.strike ? ' strike="sngStrike"' : ''}>${run.color ? `<a:solidFill><a:srgbClr val="${hex(run.color)}"/></a:solidFill>` : ''}${run.font ? `<a:latin typeface="${xmlAttribute(run.font)}"/>` : ''}</a:rPr>`;
    return run.text
      .split('\n')
      .map((line) =>
        line ? `<a:r>${properties}<a:t>${xmlText(line)}</a:t></a:r>` : ''
      )
      .join(`<a:br>${properties}</a:br>`);
  };
  const paragraphs = text.paragraphs.map((paragraph) => {
    const align =
      paragraph.align === 'center'
        ? 'ctr'
        : paragraph.align === 'right'
          ? 'r'
          : paragraph.align === 'justify'
            ? 'just'
            : undefined;
    return `<a:p>${align ? `<a:pPr algn="${align}"/>` : ''}${paragraph.runs.map(runXml).join('')}${paragraph.size ? `<a:endParaRPr lang="en-US" sz="${Math.round(paragraph.size * 100)}"/>` : ''}</a:p>`;
  });
  return `<xdr:txBody><a:bodyPr${text.clip ? ' vertOverflow="clip" horzOverflow="clip"' : ''} wrap="${text.noWrap ? 'none' : 'square'}" lIns="${left * 9525}" tIns="${top * 9525}" rIns="${right * 9525}" bIns="${bottom * 9525}" anchor="${anchor}"${vertical} rtlCol="0"/><a:lstStyle/>${paragraphs.join('') || '<a:p/>'}</xdr:txBody>`;
}

function partXml(part: ShapePart, box: Box, id: number, name: string): string {
  const geometry = part.geometry ?? 'rect';
  const connector = CONNECTORS.has(geometry) && !part.paths;
  const transform = `<a:xfrm${part.rotation ? ` rot="${Math.round(part.rotation * 60_000)}"` : ''}${part.flipH ? ' flipH="1"' : ''}${part.flipV ? ' flipV="1"' : ''}><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.width)}" cy="${emu(box.height)}"/></a:xfrm>`;
  const outline = part.paths
    ? `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${part.paths.map(drawingPath).join('')}</a:pathLst></a:custGeom>`
    : `<a:prstGeom prst="${geometry}"><a:avLst>${Object.entries(
        part.adjust ?? {}
      )
        .map(([guide, value]) => `<a:gd name="${guide}" fmla="val ${value}"/>`)
        .join('')}</a:avLst></a:prstGeom>`;
  const fill = part.fill
    ? `<a:solidFill><a:srgbClr val="${hex(part.fill)}">${part.opacity !== undefined ? `<a:alpha val="${Math.round(part.opacity * 100_000)}"/>` : ''}</a:srgbClr></a:solidFill>`
    : '<a:noFill/>';
  const line = part.line
    ? `<a:ln w="${Math.round(part.line.width * 9525)}">${part.line.color ? `<a:solidFill><a:srgbClr val="${hex(part.line.color)}"/></a:solidFill>` : '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'}${part.line.dash ? `<a:prstDash val="${({ longDash: 'lgDash', longDashDot: 'lgDashDot' } as Record<string, string>)[part.line.dash] ?? part.line.dash}"/>` : ''}${part.line.head ? `<a:headEnd type="${part.line.head}"/>` : ''}${part.line.tail ? `<a:tailEnd type="${part.line.tail}"/>` : ''}</a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  const properties = `<xdr:spPr>${transform}${outline}${connector ? '' : fill}${line}</xdr:spPr>`;
  const label = `<xdr:cNvPr id="${id}" name="${xmlAttribute(name)}"/>`;
  if (connector)
    return `<xdr:cxnSp macro=""><xdr:nvCxnSpPr>${label}<xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>${properties}</xdr:cxnSp>`;
  const link = part.text?.link
    ? ` textlink="${xmlAttribute(part.text.link)}"`
    : '';
  return `<xdr:sp macro=""${link}><xdr:nvSpPr>${label}<xdr:cNvSpPr/></xdr:nvSpPr>${properties}${part.text ? textXml(part.text) : ''}</xdr:sp>`;
}

/**
 * A shape drawing as the content of a drawing part's anchor, at `box`
 * (EMU, from the sheet's corner): its kept element, or shapes written from
 * its parts. `nextId` numbers shapes uniquely within the part.
 */
export function shapeXml(
  shape: SheetShape,
  box: Box,
  nextId: () => number,
  name = 'Shape'
): string {
  if (shape.source) {
    // A shape shows the cell its text is linked to now.
    const link =
      shape.parts.length === 1 ? shape.parts[0].text?.link : undefined;
    const source = shape.source.replace(/^<xdr:sp\b[^>]*>/, (tag) => {
      const without = tag.replace(/\stextlink="[^"]*"/, '');
      return link
        ? without.replace(
            /^<xdr:sp\b/,
            `<xdr:sp textlink="${xmlAttribute(link)}"`
          )
        : without;
    });
    return placedSource(source, box, nextId);
  }
  const place = (part: ShapePart): Box => ({
    x: box.x + part.x * box.width,
    y: box.y + part.y * box.height,
    width: Math.max(0, part.width * box.width),
    height: Math.max(0, part.height * box.height),
  });
  if (shape.parts.length === 1)
    return partXml(shape.parts[0], place(shape.parts[0]), nextId(), name);
  const id = nextId();
  const members = shape.parts
    .map((part, index) =>
      partXml(part, place(part), nextId(), `${name} ${index + 1}`)
    )
    .join('');
  return `<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="${id}" name="${xmlAttribute(name)}"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.width)}" cy="${emu(box.height)}"/><a:chOff x="${emu(box.x)}" y="${emu(box.y)}"/><a:chExt cx="${emu(box.width)}" cy="${emu(box.height)}"/></a:xfrm></xdr:grpSpPr>${members}</xdr:grpSp>`;
}
