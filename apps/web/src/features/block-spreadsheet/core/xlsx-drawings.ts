import {
  type ChartGrouping,
  type ChartKind,
  type ChartPlot,
  type ChartSeries,
  type DrawingPoint,
  MAX_CHART_SOURCE_LENGTH,
  MAX_SHEET_DRAWINGS,
  type SheetChart,
  type SheetDrawing,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { match } from 'ts-pattern';
import type { ChartValue } from './chart-data';
import {
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from './spreadsheet-document';
import type { XlsxArchive } from './xlsx-archive';
import { attributes, parse, relationships } from './xlsx-parts';
import { withLightness } from './xlsx-stylesheet';

export const EMU_PER_PIXEL = 9525;
const XDR =
  'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const CHART_NAMESPACE =
  'http://schemas.openxmlformats.org/drawingml/2006/chart';
const COMPATIBILITY =
  'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** One image's data, and all images of a workbook, at most. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_WORKBOOK_IMAGE_BYTES = 16 * 1024 * 1024;

/** The workbook-wide state drawings share while sheets are read. */
export type DrawingImports = {
  /** Images by content key, as data URLs. */
  images: Record<string, string>;
  imageBytes: number;
  /** Image parts already read, by archive path. */
  imageKeys: Map<string, string | undefined>;
};

export function drawingImports(): DrawingImports {
  return { images: {}, imageBytes: 0, imageKeys: new Map() };
}

/** A content key: equal images share one stored copy. */
export function imageKey(bytes: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9747b28c ^ bytes.length;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x5bd1e995);
    second ^= second >>> 15;
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

/** The image type browsers can display, from the data itself. */
export function imageType(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'webp';
  if (starts(0x42, 0x4d)) return 'bmp';
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/** Read an image part once per workbook, within the size limits. */
function importImage(
  archive: XlsxArchive,
  path: string,
  state: DrawingImports,
  warnings: Set<string>
): string | undefined {
  if (state.imageKeys.has(path)) return state.imageKeys.get(path);
  let key: string | undefined;
  const bytes = archive.read(path);
  const type = bytes && imageType(bytes);
  if (!bytes) key = undefined;
  else if (!type)
    warnings.add(
      'Images in formats browsers cannot show, such as EMF and WMF, are not imported.'
    );
  else if (
    bytes.length > MAX_IMAGE_BYTES ||
    state.imageBytes + bytes.length > MAX_WORKBOOK_IMAGE_BYTES
  )
    warnings.add(
      'Images larger than 2 MB, or beyond 16 MB in a workbook, are not imported.'
    );
  else {
    key = imageKey(bytes);
    if (!(key in state.images)) {
      state.images[key] = `data:image/${type};base64,${base64(bytes)}`;
      state.imageBytes += bytes.length;
    }
  }
  state.imageKeys.set(path, key);
  return key;
}

type Marker = { col: number; colOff: number; row: number; rowOff: number };

/** A drawing's corner within Macro's grid, or undefined beyond it. */
function point(marker: Marker | undefined): DrawingPoint | undefined {
  if (
    !marker ||
    marker.row < 0 ||
    marker.col < 0 ||
    marker.row >= SPREADSHEET_MAX_ROWS ||
    marker.col >= SPREADSHEET_MAX_COLUMNS
  )
    return;
  return {
    row: marker.row,
    column: marker.col,
    x: Math.max(0, Math.round(marker.colOff / EMU_PER_PIXEL)),
    y: Math.max(0, Math.round(marker.rowOff / EMU_PER_PIXEL)),
  };
}

const pixels = (emu: number) =>
  Math.max(1, Math.min(100_000, Math.round(emu / EMU_PER_PIXEL)));

const SCHEME_COLORS: Record<string, number> = {
  bg1: 0,
  lt1: 0,
  tx1: 1,
  dk1: 1,
  bg2: 2,
  lt2: 2,
  tx2: 3,
  dk2: 3,
  accent1: 4,
  accent2: 5,
  accent3: 6,
  accent4: 7,
  accent5: 8,
  accent6: 9,
  hlink: 10,
  folHlink: 11,
};
/** Office's default theme accents, for workbooks without a theme. */
const DEFAULT_ACCENTS = [
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
];

/** A DrawingML color being read: its base and the modifiers that follow. */
type PendingColor = { hex?: string; modifiers: [string, number][] };

function finishColor(color: PendingColor): string | undefined {
  let hex = color.hex;
  if (!hex) return;
  let multiply = 1;
  let offset = 0;
  for (const [name, value] of color.modifiers) {
    const amount = value / 100_000;
    if (name === 'lumMod') multiply *= amount;
    else if (name === 'lumOff') offset += amount;
    else if (name === 'shade' || name === 'tint') {
      const channels = [0, 2, 4].map(
        (index) => Number.parseInt(hex!.slice(index, index + 2), 16) / 255
      );
      hex = channels
        .map((channel) =>
          Math.round(
            (name === 'shade'
              ? channel * amount
              : channel * amount + 1 - amount) * 255
          )
            .toString(16)
            .padStart(2, '0')
        )
        .join('')
        .toUpperCase();
    }
  }
  if (multiply !== 1 || offset)
    hex = withLightness(hex, (lightness) => lightness * multiply + offset);
  return `#${hex.toUpperCase()}`;
}

/** Office's default theme colors, by `SCHEME_COLORS` index. */
const DEFAULT_THEME = [
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  ...DEFAULT_ACCENTS,
  '0563C1',
  '954F72',
];

/** A scheme color of the theme as RRGGBB, Office's when it has none. */
function schemeColor(
  theme: (string | undefined)[],
  name: string
): string | undefined {
  const index = SCHEME_COLORS[name];
  if (index === undefined) return;
  return theme[index] ?? DEFAULT_THEME[index];
}

/** The theme's accent colors as #RRGGBB, Office's when it has none. */
export function themeAccents(theme: (string | undefined)[]): string[] {
  return DEFAULT_ACCENTS.map(
    (fallback, index) => `#${theme[4 + index] ?? fallback}`
  );
}

/** The prefix of the chart namespace in a part, `''` when it is the default. */
function chartPrefix(source: string): string | undefined {
  const match =
    /xmlns:([A-Za-z_][\w.-]*)="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/chart"/.exec(
      source
    );
  if (match) return `${match[1]}:`;
  if (
    /xmlns="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/chart"/.test(
      source
    )
  )
    return '';
}

/**
 * The chart part as Macro keeps it for export: without cached values, which
 * export writes again, and without parts it does not keep. Undefined when it
 * refers to other parts or is too large.
 */
function chartSource(
  xml: string,
  theme: (string | undefined)[]
): string | undefined {
  const prefix = chartPrefix(xml);
  if (prefix === undefined) return;
  const name = (local: string) => `${prefix}${local}`.replace('.', '\\.');
  let source = xml.replace(/^<\?xml[^>]*>\s*/, '');
  for (const local of ['numCache', 'strCache', 'multiLvlStrCache'])
    source = source.replace(
      new RegExp(
        `<${name(local)}(?:\\s[^>]*)?>[\\s\\S]*?</${name(local)}>`,
        'g'
      ),
      ''
    );
  for (const local of ['externalData', 'userShapes', 'printSettings'])
    source = source
      .replace(new RegExp(`<${name(local)}\\b[^>]*/>`, 'g'), '')
      .replace(
        new RegExp(`<${name(local)}\\b[^>]*>[\\s\\S]*?</${name(local)}>`, 'g'),
        ''
      );
  if (/\br:(?:id|embed|link)=/.test(source)) return;
  // Theme colors become the colors they were, whatever theme exports carry.
  const drawing =
    /xmlns:([A-Za-z_][\w.-]*)="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/main"/.exec(
      source
    )?.[1];
  if (drawing)
    source = source.replace(
      new RegExp(
        `<${drawing}:schemeClr val="(\\w+)"\\s*(?:/>|>([\\s\\S]*?)</${drawing}:schemeClr>)`,
        'g'
      ),
      (element: string, scheme: string, modifiers: string | undefined) => {
        const color = schemeColor(theme, scheme);
        if (!color) return element;
        return modifiers === undefined
          ? `<${drawing}:srgbClr val="${color}"/>`
          : `<${drawing}:srgbClr val="${color}">${modifiers}</${drawing}:srgbClr>`;
      }
    );
  return source.length <= MAX_CHART_SOURCE_LENGTH ? source : undefined;
}

const CHART_TYPES: Record<string, ChartKind | 'bar'> = {
  barChart: 'bar',
  bar3DChart: 'bar',
  lineChart: 'line',
  line3DChart: 'line',
  areaChart: 'area',
  area3DChart: 'area',
  pieChart: 'pie',
  pie3DChart: 'pie',
  ofPieChart: 'pie',
  doughnutChart: 'doughnut',
  scatterChart: 'scatter',
};
const UNSUPPORTED_CHARTS = new Set([
  'radarChart',
  'bubbleChart',
  'stockChart',
  'surfaceChart',
  'surface3DChart',
]);
const LEGENDS = {
  r: 'right',
  tr: 'right',
  l: 'left',
  t: 'top',
  b: 'bottom',
} as const;

type PendingPlot = {
  local: string;
  plot: ChartPlot;
  axes: string[];
  direction?: string;
};

/** Read a chart part into what Macro draws, keeping the part for export. */
export function readChart(
  archive: XlsxArchive,
  path: string,
  theme: (string | undefined)[],
  warnings: Set<string>
): SheetChart | undefined {
  const bytes = archive.read(path);
  if (!bytes) return;
  const references: string[] = [];
  const plots: PendingPlot[] = [];
  const rightAxes = new Set<string>();
  let title: string | undefined;
  let titleSeen = false;
  let titleDeleted = false;
  let legend: SheetChart['legend'];
  let unsupported = false;
  // Element names from the chart root down, without prefixes.
  const stack: string[] = [];
  let plot: PendingPlot | undefined;
  let series: ChartSeries | undefined;
  // A series name's cached texts; a name spanning cells joins them.
  let nameParts: string[] = [];
  let text: string | undefined;
  let color: PendingColor | undefined;
  let seriesColorDepth: number | undefined;
  let axis: { id?: string; position?: string; crosses?: string } | undefined;
  // The chart's own title, not an axis title; its depth in `stack`.
  let titleDepth: number | undefined;
  /** The child of the series an element is inside, such as `tx` or `val`. */
  const seriesPart = () => {
    const index = stack.lastIndexOf('ser');
    return index < 0 ? undefined : stack[index + 1];
  };
  parse(bytes, path, (parser) => {
    parser.on('opentag', (node) => {
      const value = attributes(node);
      const parent = stack.at(-1);
      stack.push(node.local);
      if (node.uri === CHART_NAMESPACE) {
        if (node.local === 'title' && parent === 'chart') {
          titleSeen = true;
          titleDepth = stack.length;
        } else if (node.local === 'autoTitleDeleted' && parent === 'chart')
          titleDeleted = value.val === '1' || value.val === 'true';
        else if (node.local === 'legendPos')
          legend = LEGENDS[value.val as keyof typeof LEGENDS] ?? 'right';
        else if (node.local === 'legend') legend ??= 'right';
        else if (parent === 'plotArea' && CHART_TYPES[node.local]) {
          const kind = CHART_TYPES[node.local];
          plot = {
            local: node.local,
            plot: { kind: kind === 'bar' ? 'column' : kind, series: [] },
            axes: [],
          };
        } else if (parent === 'plotArea' && UNSUPPORTED_CHARTS.has(node.local))
          unsupported = true;
        else if (plot && parent === plot.local) {
          if (node.local === 'barDir') plot.direction = value.val;
          else if (node.local === 'grouping')
            plot.plot.grouping =
              value.val === 'stacked' || value.val === 'percentStacked'
                ? (value.val as ChartGrouping)
                : undefined;
          else if (node.local === 'axId') plot.axes.push(value.val ?? '');
          else if (node.local === 'ser') series = { values: -1 };
        } else if (
          parent === 'plotArea' &&
          (node.local === 'valAx' ||
            node.local === 'catAx' ||
            node.local === 'dateAx')
        )
          axis = {};
        else if (axis && node.local === 'axId' && parent?.endsWith('Ax'))
          axis.id = value.val;
        else if (axis && node.local === 'axPos') axis.position = value.val;
        else if (axis && node.local === 'crosses') axis.crosses = value.val;
        else if (node.local === 'f') text = '';
        else if (
          node.local === 'v' &&
          (titleDepth !== undefined || (series && seriesPart() === 'tx'))
        )
          text = '';
        else if (series && node.local === 'spPr' && parent === 'ser')
          seriesColorDepth = stack.length;
      } else if (node.uri === DRAWING) {
        if (
          series &&
          node.local === 'noFill' &&
          seriesColorDepth !== undefined
        ) {
          if (stack.length - 1 === seriesColorDepth) series.noFill = true;
          else if (parent === 'ln' && stack.length - 2 === seriesColorDepth)
            series.noLine = true;
        }
        if (node.local === 't' && titleDepth !== undefined) text = '';
        else if (
          seriesColorDepth !== undefined &&
          series &&
          !series.color &&
          parent === 'solidFill'
        ) {
          if (node.local === 'srgbClr')
            color = { hex: value.val, modifiers: [] };
          else if (node.local === 'schemeClr')
            color = { hex: schemeColor(theme, value.val ?? ''), modifiers: [] };
          else if (node.local === 'sysClr')
            color = { hex: value.lastClr, modifiers: [] };
        } else if (color && value.val !== undefined)
          color.modifiers.push([node.local, Number(value.val)]);
      }
    });
    parser.on('text', (chunk) => {
      if (text !== undefined) text += chunk;
    });
    parser.on('closetag', (node) => {
      stack.pop();
      const parent = stack.at(-1);
      if (node.uri === DRAWING) {
        if (node.local === 't' && text !== undefined) {
          title = (title ?? '') + text;
          text = undefined;
        } else if (
          color &&
          (node.local === 'srgbClr' ||
            node.local === 'schemeClr' ||
            node.local === 'sysClr')
        ) {
          if (series && /^[0-9a-f]{6}$/i.test(color.hex ?? ''))
            series.color = finishColor(color);
          color = undefined;
        }
        return;
      }
      if (node.uri !== CHART_NAMESPACE) return;
      if (node.local === 'f' && text !== undefined) {
        references.push(text.trim());
        const index = references.length - 1;
        text = undefined;
        const part = series && seriesPart();
        if (series && part === 'tx') series.nameRef = index;
        else if (series && (part === 'cat' || part === 'xVal'))
          series.categories = index;
        else if (series && (part === 'val' || part === 'yVal'))
          series.values = index;
      } else if (node.local === 'v' && text !== undefined) {
        if (series && seriesPart() === 'tx') nameParts.push(text.trim());
        else if (titleDepth !== undefined) title ??= text;
        text = undefined;
      } else if (node.local === 'title' && stack.length < (titleDepth ?? 0))
        titleDepth = undefined;
      else if (node.local === 'spPr' && stack.length < (seriesColorDepth ?? 0))
        seriesColorDepth = undefined;
      else if (node.local === 'ser' && series && plot) {
        const name = nameParts.filter(Boolean).join(' ');
        if (name) series.name = name;
        nameParts = [];
        if (series.values >= 0) plot.plot.series.push(series);
        series = undefined;
        seriesColorDepth = undefined;
      } else if (plot && node.local === plot.local) {
        if (plot.direction === 'bar') plot.plot.kind = 'bar';
        plots.push(plot);
        plot = undefined;
      } else if (axis && parent === 'plotArea' && node.local.endsWith('Ax')) {
        // A value axis crossing at the maximum is drawn on the far side.
        if (
          axis.id &&
          (axis.position === 'r' ||
            axis.position === 't' ||
            (node.local === 'valAx' && axis.crosses === 'max'))
        )
          rightAxes.add(axis.id);
        axis = undefined;
      }
    });
  });
  if (unsupported)
    warnings.add(
      'Radar, bubble, stock and surface charts are kept for export but not drawn.'
    );
  const xml = new TextDecoder().decode(bytes);
  const source = chartSource(xml, theme);
  if (!source)
    warnings.add(
      'Some charts keep only their data and type; their formatting is not exported.'
    );
  const first = plots[0]?.axes.join(' ');
  const chartPlots = plots.map(({ plot: value, axes }, index) => ({
    ...value,
    // A later plot on other axes uses Excel's secondary value axis.
    ...(index > 0 &&
      axes.join(' ') !== first &&
      axes.some((id) => rightAxes.has(id)) && { secondary: true }),
  }));
  const allSeries = chartPlots.flatMap((value) => value.series);
  // A title element without text shows the only series' name, as in Excel.
  if (
    titleSeen &&
    !titleDeleted &&
    title === undefined &&
    allSeries.length === 1
  )
    title = allSeries[0].name;
  const shownTitle = titleSeen && !titleDeleted ? title?.trim() : undefined;
  return {
    ...(shownTitle && { title: shownTitle }),
    ...(legend && { legend }),
    plots: chartPlots,
    references,
    colors: themeAccents(theme),
    ...(source && { source }),
  };
}

type PendingAnchor = {
  kind: string;
  editAs?: string;
  from?: Marker;
  to?: Marker;
  marker?: Marker;
  field?: keyof Marker;
  position?: { x: number; y: number };
  extent?: { cx: number; cy: number };
  content?:
    | {
        type: 'pic';
        embed?: string;
        name?: string;
        description?: string;
        extent?: { cx: number; cy: number };
      }
    | { type: 'chart'; id?: string; name?: string }
    | { type: 'other' };
};

/**
 * The images and charts of a sheet's drawing part, anchored to cells.
 * `locate` turns a position in pixels into a cell and an offset, for
 * drawings Excel places absolutely.
 */
export function readSheetDrawings(options: {
  archive: XlsxArchive;
  sheetPath: string;
  theme: (string | undefined)[];
  warnings: Set<string>;
  state: DrawingImports;
  locate: (x: number, y: number) => DrawingPoint | undefined;
}): SheetDrawing[] {
  const { archive, warnings } = options;
  const drawingPath = [
    ...relationships(archive, options.sheetPath).values(),
  ].find(
    (relation) => relation.type === 'drawing' && !relation.external
  )?.target;
  const bytes = drawingPath && archive.read(drawingPath);
  if (!drawingPath || !bytes) return [];
  const relations = relationships(archive, drawingPath);
  const drawings: SheetDrawing[] = [];
  let anchor: PendingAnchor | undefined;
  let skipped = 0;
  let unsupported = false;
  let text: string | undefined;
  // Excel 2010 content has a fallback older readers use; read only that.
  let choiceDepth = 0;
  const stack: string[] = [];
  const finish = (value: PendingAnchor) => {
    const content = value.content;
    if (!content || content.type === 'other') {
      unsupported = true;
      return;
    }
    let from = point(value.from);
    let to = value.kind === 'twoCellAnchor' ? point(value.to) : undefined;
    let extent = value.extent;
    if (value.kind === 'absoluteAnchor' && value.position) {
      from = options.locate(
        value.position.x / EMU_PER_PIXEL,
        value.position.y / EMU_PER_PIXEL
      );
      to = undefined;
    }
    // Pictures that move but do not size with their cells keep their size.
    if (
      value.kind === 'twoCellAnchor' &&
      value.editAs !== undefined &&
      value.editAs !== 'twoCell' &&
      content.type === 'pic' &&
      content.extent &&
      content.extent.cx > 0 &&
      content.extent.cy > 0
    ) {
      to = undefined;
      extent = content.extent;
    }
    if (!from || (!to && !(extent && extent.cx > 0 && extent.cy > 0))) {
      skipped++;
      return;
    }
    if (drawings.length >= MAX_SHEET_DRAWINGS) {
      skipped++;
      return;
    }
    const placement = {
      id: `drawing-${drawings.length + 1}`,
      ...(content.name && { name: content.name.slice(0, 256) }),
      from,
      ...(to
        ? { to }
        : { width: pixels(extent!.cx), height: pixels(extent!.cy) }),
    };
    const target = relations.get(
      (content.type === 'pic' ? content.embed : content.id) ?? ''
    );
    if (!target || target.external) {
      skipped++;
      return;
    }
    if (content.type === 'pic') {
      const image = importImage(
        archive,
        target.target,
        options.state,
        warnings
      );
      if (!image) return;
      drawings.push({
        ...placement,
        type: 'image',
        image,
        ...(content.description && {
          description: content.description.slice(0, 1_000),
        }),
      });
    } else {
      const chart = readChart(archive, target.target, options.theme, warnings);
      if (chart) drawings.push({ ...placement, type: 'chart', chart });
      else skipped++;
    }
  };
  parse(bytes, drawingPath, (parser) => {
    parser.on('opentag', (node) => {
      const value = attributes(node);
      const parent = stack.at(-1);
      stack.push(node.local);
      if (node.uri === COMPATIBILITY && node.local === 'Choice') {
        choiceDepth++;
        return;
      }
      if (choiceDepth) return;
      if (
        node.uri === XDR &&
        ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(
          node.local
        ) &&
        !anchor
      ) {
        anchor = { kind: node.local, editAs: value.editAs };
        return;
      }
      if (!anchor) return;
      if (node.uri === XDR) {
        if (
          (node.local === 'from' || node.local === 'to') &&
          parent === anchor.kind
        ) {
          anchor.marker = { col: 0, colOff: 0, row: 0, rowOff: 0 };
          anchor[node.local] = anchor.marker;
        } else if (
          anchor.marker &&
          ['col', 'colOff', 'row', 'rowOff'].includes(node.local)
        ) {
          anchor.field = node.local as keyof Marker;
          text = '';
        } else if (node.local === 'pos' && parent === anchor.kind)
          anchor.position = {
            x: Number(value.x) || 0,
            y: Number(value.y) || 0,
          };
        else if (node.local === 'ext' && parent === anchor.kind)
          anchor.extent = {
            cx: Number(value.cx) || 0,
            cy: Number(value.cy) || 0,
          };
        else if (parent === anchor.kind && !anchor.content) {
          if (node.local === 'pic') anchor.content = { type: 'pic' };
          else if (node.local === 'graphicFrame')
            anchor.content = { type: 'chart' };
          else if (['sp', 'grpSp', 'cxnSp', 'contentPart'].includes(node.local))
            anchor.content = { type: 'other' };
        } else if (
          node.local === 'cNvPr' &&
          anchor.content &&
          anchor.content.type !== 'other'
        ) {
          anchor.content.name = value.name;
          if (anchor.content.type === 'pic' && value.descr)
            anchor.content.description = value.descr;
        }
      } else if (node.uri === DRAWING && anchor.content?.type === 'pic') {
        if (node.local === 'blip') anchor.content.embed = value.embed;
        else if (node.local === 'ext' && parent === 'xfrm')
          anchor.content.extent = {
            cx: Number(value.cx) || 0,
            cy: Number(value.cy) || 0,
          };
      } else if (
        node.uri === DRAWING &&
        node.local === 'graphicData' &&
        anchor.content?.type === 'chart' &&
        value.uri !== CHART_NAMESPACE
      )
        anchor.content = { type: 'other' };
      else if (
        node.uri === CHART_NAMESPACE &&
        node.local === 'chart' &&
        anchor.content?.type === 'chart'
      )
        anchor.content.id = value.id;
    });
    parser.on('text', (chunk) => {
      if (text !== undefined) text += chunk;
    });
    parser.on('closetag', (node) => {
      stack.pop();
      if (node.uri === COMPATIBILITY && node.local === 'Choice') {
        choiceDepth--;
        return;
      }
      if (choiceDepth || !anchor) return;
      if (anchor.field && text !== undefined && anchor.marker) {
        anchor.marker[anchor.field] = Number(text.trim()) || 0;
        anchor.field = undefined;
        text = undefined;
      } else if (
        node.uri === XDR &&
        (node.local === 'from' || node.local === 'to')
      )
        anchor.marker = undefined;
      else if (node.uri === XDR && node.local === anchor.kind) {
        finish(anchor);
        anchor = undefined;
      }
    });
  });
  if (unsupported)
    warnings.add('Shapes, text boxes and SmartArt are not imported.');
  if (skipped)
    warnings.add(
      'Some images and charts could not be placed and are not imported.'
    );
  return drawings;
}

// Export -------------------------------------------------------------------

export type ChartValues = (reference: string) => ChartValue[] | undefined;

const RELATIONSHIPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function xml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const numberText = (value: number) =>
  Number.isInteger(value)
    ? String(value)
    : String(Number(value.toPrecision(15)));

/** Cached values Excel and viewers draw from until they recalculate. */
function cache(
  prefix: string,
  kind: 'numRef' | 'strRef',
  values: ChartValue[] | undefined
): string {
  if (!values?.length) return '';
  const element = (local: string) => `${prefix}${local}`;
  const points = values
    .map((value, index) =>
      kind === 'numRef'
        ? value.number === undefined
          ? ''
          : `<${element('pt')} idx="${index}"><${element('v')}>${numberText(value.number)}</${element('v')}></${element('pt')}>`
        : value.text
          ? `<${element('pt')} idx="${index}"><${element('v')}>${xml(value.text)}</${element('v')}></${element('pt')}>`
          : ''
    )
    .join('');
  return kind === 'numRef'
    ? `<${element('numCache')}><${element('formatCode')}>General</${element('formatCode')}><${element('ptCount')} val="${values.length}"/>${points}</${element('numCache')}>`
    : `<${element('strCache')}><${element('ptCount')} val="${values.length}"/>${points}</${element('strCache')}>`;
}

/**
 * A pivot chart's link to its pivot table, `[Book.xlsx]Sheet!PivotTable1`,
 * as a sheet and a table name.
 */
function pivotSource(link: string) {
  const match = /^(?:\[[^\]]*\])?(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(
    link.trim()
  );
  return (
    match && {
      sheet: match[1]?.replace(/''/g, "'") ?? match[2],
      name: match[3],
    }
  );
}

/**
 * The chart part Macro kept, with its references as they are now and caches
 * of their current values. Undefined if the part no longer matches them.
 * A pivot chart whose pivot table is not in the download becomes a chart of
 * its cells, as Excel makes it when the pivot table is deleted.
 */
function keptChart(
  chart: SheetChart,
  values: ChartValues,
  pivotExists: (sheet: string, name: string) => boolean
): string | undefined {
  let source = chart.source;
  const prefix = source && chartPrefix(source);
  if (!source || prefix === undefined) return;
  const name = (local: string) => `${prefix}${local}`;
  const link = new RegExp(
    `<${name('pivotSource')}>[\\s\\S]*?<${name('name')}>([^<]*)</${name('name')}>[\\s\\S]*?</${name('pivotSource')}>`
  ).exec(source);
  const linked =
    link && pivotSource(link[1].replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
  if (link && !(linked && pivotExists(linked.sheet, linked.name)))
    source = source
      .replace(link[0], '')
      .replace(
        /<(?:[\w.-]+:)?ext\b[^>]*>\s*<(?:[\w.-]+:)?pivotOptions\w*\b[\s\S]*?<\/(?:[\w.-]+:)?ext>/g,
        ''
      );
  const formula = new RegExp(`<${name('f')}>([^<]*)</${name('f')}>`, 'g');
  if ((source.match(formula) ?? []).length !== chart.references.length) return;
  let index = 0;
  const referenced = source.replace(
    formula,
    () => `<${name('f')}>${xml(chart.references[index++])}</${name('f')}>`
  );
  const withCaches = referenced.replace(
    new RegExp(
      `<${name('(numRef|strRef)')}>(\\s*)<${name('f')}>([^<]*)</${name('f')}>`,
      'g'
    ),
    (match, kind: 'numRef' | 'strRef', _space: string, reference: string) =>
      `${match}${cache(
        prefix,
        kind,
        values(
          reference
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
        )
      )}`
  );
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${withCaches}`;
}

/** A chart part made from what Macro knows of the chart. */
function generatedChart(chart: SheetChart, values: ChartValues): string {
  const reference = (index: number | undefined, kind: 'numRef' | 'strRef') =>
    index === undefined
      ? ''
      : `<c:${kind}><c:f>${xml(chart.references[index])}</c:f>${cache(
          'c:',
          kind,
          values(chart.references[index])
        )}</c:${kind}>`;
  const palette = chart.colors ?? themeAccents([]);
  let seriesIndex = 0;
  const groups = chart.plots.map((plot) => {
    const axes = plot.secondary ? [3, 4] : [1, 2];
    const series = plot.series
      .map((value) => {
        const index = seriesIndex++;
        const color = (value.color ?? palette[index % palette.length]).slice(1);
        const solid = `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
        const fill =
          plot.kind === 'line' || plot.kind === 'scatter'
            ? `<c:spPr><a:ln w="28575" cap="rnd">${value.noLine ? '<a:noFill/>' : solid}<a:round/></a:ln></c:spPr>`
            : plot.kind === 'pie' || plot.kind === 'doughnut'
              ? ''
              : `<c:spPr>${value.noFill ? '<a:noFill/>' : solid}</c:spPr>`;
        const name =
          value.nameRef !== undefined
            ? `<c:tx>${reference(value.nameRef, 'strRef')}</c:tx>`
            : value.name
              ? `<c:tx><c:v>${xml(value.name)}</c:v></c:tx>`
              : '';
        const categories =
          plot.kind === 'scatter'
            ? value.categories === undefined
              ? ''
              : `<c:xVal>${reference(value.categories, 'numRef')}</c:xVal>`
            : value.categories === undefined
              ? ''
              : `<c:cat>${reference(value.categories, 'strRef')}</c:cat>`;
        const numbers =
          plot.kind === 'scatter'
            ? `<c:yVal>${reference(value.values, 'numRef')}</c:yVal>`
            : `<c:val>${reference(value.values, 'numRef')}</c:val>`;
        const marker =
          plot.kind === 'line'
            ? '<c:marker><c:symbol val="none"/></c:marker>'
            : plot.kind === 'scatter'
              ? '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>'
              : '';
        return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${name}${fill}${plot.kind === 'column' || plot.kind === 'bar' ? '<c:invertIfNegative val="0"/>' : ''}${marker}${categories}${numbers}${plot.kind === 'line' || plot.kind === 'scatter' ? '<c:smooth val="0"/>' : ''}</c:ser>`;
      })
      .join('');
    const grouping = plot.grouping ?? 'clustered';
    const axisIds = axes.map((id) => `<c:axId val="${id}"/>`).join('');
    const stacking = grouping === 'clustered' ? 'standard' : grouping;
    return match(plot.kind)
      .with(
        'column',
        'bar',
        (kind) =>
          `<c:barChart><c:barDir val="${kind === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${series}<c:gapWidth val="150"/>${grouping === 'clustered' ? '' : '<c:overlap val="100"/>'}${axisIds}</c:barChart>`
      )
      .with(
        'line',
        () =>
          `<c:lineChart><c:grouping val="${stacking}"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${axisIds}</c:lineChart>`
      )
      .with(
        'area',
        () =>
          `<c:areaChart><c:grouping val="${stacking}"/><c:varyColors val="0"/>${series}${axisIds}</c:areaChart>`
      )
      .with(
        'pie',
        () =>
          `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`
      )
      .with(
        'doughnut',
        () =>
          `<c:doughnutChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`
      )
      .with(
        'scatter',
        () =>
          `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}${axisIds}</c:scatterChart>`
      )
      .exhaustive();
  });
  const axisPairs = [false, true].flatMap((secondary) => {
    const plot = chart.plots.find(
      (value) =>
        !!value.secondary === secondary &&
        value.kind !== 'pie' &&
        value.kind !== 'doughnut'
    );
    if (!plot) return [];
    const [category, value] = secondary ? [3, 4] : [1, 2];
    const horizontal = plot.kind === 'bar';
    const categoryPosition = horizontal ? 'l' : 'b';
    const valuePosition = secondary
      ? horizontal
        ? 't'
        : 'r'
      : horizontal
        ? 'b'
        : 'l';
    const categoryAxis =
      plot.kind === 'scatter'
        ? `<c:valAx><c:axId val="${category}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${secondary ? 1 : 0}"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${value}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
        : `<c:catAx><c:axId val="${category}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${secondary ? 1 : 0}"/><c:axPos val="${categoryPosition}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${value}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
    const valueAxis = `<c:valAx><c:axId val="${value}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${valuePosition}"/>${secondary ? '' : '<c:majorGridlines/>'}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${category}"/><c:crosses val="${secondary ? 'max' : 'autoZero'}"/><c:crossBetween val="${plot.kind === 'scatter' ? 'midCat' : 'between'}"/></c:valAx>`;
    return [categoryAxis, valueAxis];
  });
  const title = chart.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const legend = chart.legend
    ? `<c:legend><c:legendPos val="${chart.legend[0]}"/><c:overlay val="0"/></c:legend>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${CHART_NAMESPACE}" xmlns:a="${DRAWING}" xmlns:r="${RELATIONSHIPS}"><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${groups.join('')}${axisPairs.join('')}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

/** A chart part for export: the one imported when it still fits. */
export function chartPart(
  chart: SheetChart,
  values: ChartValues,
  pivotExists: (sheet: string, name: string) => boolean = () => false
): string {
  return keptChart(chart, values, pivotExists) ?? generatedChart(chart, values);
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'png',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
};

/** An image's bytes and file extension from its data URL. */
export function imageFile(
  url: string
): { bytes: Uint8Array; extension: string } | undefined {
  const match = /^data:image\/([a-z]+);base64,(.*)$/.exec(url);
  const extension = match && IMAGE_EXTENSIONS[match[1]];
  if (!match || !extension) return;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return { bytes, extension };
}

const marker = (local: 'from' | 'to', point: DrawingPoint) =>
  `<xdr:${local}><xdr:col>${point.column}</xdr:col><xdr:colOff>${Math.round(point.x * EMU_PER_PIXEL)}</xdr:colOff><xdr:row>${point.row}</xdr:row><xdr:rowOff>${Math.round(point.y * EMU_PER_PIXEL)}</xdr:rowOff></xdr:${local}>`;

/**
 * A sheet's drawing part and its relationships. `image` gives the archive
 * path of an image, written once per workbook; `chart` the path of a new
 * chart part; `size` a drawing's size in pixels, for picture extents.
 */
export function drawingPart(options: {
  drawings: SheetDrawing[];
  image: (key: string) => string | undefined;
  chart: (chart: SheetChart) => string;
  size: (drawing: SheetDrawing) => { width: number; height: number };
}): { xml: string; rels: string } | undefined {
  const relations: string[] = [];
  const anchors: string[] = [];
  options.drawings.forEach((drawing, index) => {
    const id = index + 2;
    let content: string;
    if (drawing.type === 'image') {
      const path = options.image(drawing.image);
      if (!path) return;
      relations.push(
        `<Relationship Id="rId${relations.length + 1}" Type="${RELATIONSHIPS}/image" Target="../${path.replace(/^xl\//, '')}"/>`
      );
      const { width, height } = options.size(drawing);
      content = `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${xml(drawing.name ?? `Picture ${index + 1}`)}"${drawing.description ? ` descr="${xml(drawing.description)}"` : ''}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${relations.length}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(width * EMU_PER_PIXEL)}" cy="${Math.round(height * EMU_PER_PIXEL)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
    } else {
      const path = options.chart(drawing.chart);
      relations.push(
        `<Relationship Id="rId${relations.length + 1}" Type="${RELATIONSHIPS}/chart" Target="../${path.replace(/^xl\//, '')}"/>`
      );
      content = `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${xml(drawing.name ?? `Chart ${index + 1}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${CHART_NAMESPACE}"><c:chart xmlns:c="${CHART_NAMESPACE}" r:id="rId${relations.length}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
    }
    anchors.push(
      drawing.to
        ? `<xdr:twoCellAnchor>${marker('from', drawing.from)}${marker('to', drawing.to)}${content}<xdr:clientData/></xdr:twoCellAnchor>`
        : `<xdr:oneCellAnchor>${marker('from', drawing.from)}<xdr:ext cx="${Math.round((drawing.width ?? 0) * EMU_PER_PIXEL)}" cy="${Math.round((drawing.height ?? 0) * EMU_PER_PIXEL)}"/>${content}<xdr:clientData/></xdr:oneCellAnchor>`
    );
  });
  if (!anchors.length) return;
  return {
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${DRAWING}" xmlns:r="${RELATIONSHIPS}">${anchors.join('')}</xdr:wsDr>`,
    rels: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`,
  };
}

/**
 * A workbook theme. Charts take automatic series, gridline and text colors
 * from it; `accents` keeps those of the imported workbook.
 */
export function themePart(accents: string[] = themeAccents([])): string {
  const color = (name: string, hex: string) =>
    `<a:${name}><a:srgbClr val="${hex.replace('#', '').toUpperCase()}"/></a:${name}>`;
  const fill = (lumMod: number) =>
    `<a:solidFill><a:schemeClr val="phClr"><a:lumMod val="${lumMod}"/></a:schemeClr></a:solidFill>`;
  const line = (width: number) =>
    `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${DRAWING}" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${color('dk2', '44546A')}${color('lt2', 'E7E6E6')}${accents
    .slice(0, 6)
    .map((hex, index) => color(`accent${index + 1}`, hex))
    .join(
      ''
    )}${color('hlink', '0563C1')}${color('folHlink', '954F72')}</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>${fill(110000)}${fill(95000)}</a:fillStyleLst><a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>${fill(95000)}${fill(90000)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}
