import {
  type ChartGrouping,
  type ChartKind,
  type ChartPlot,
  type ChartSeries,
  type ChartValue,
  chartLiteral,
  type DrawingPoint,
  MAX_CHART_SOURCE_LENGTH,
  MAX_SHEET_DRAWINGS,
  parseChartLiteral,
  type SheetChart,
  type SheetDrawing,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { match } from 'ts-pattern';
import {
  finishColor,
  type PendingColor,
  resolveSchemeColors,
  schemeColor,
  themeAccents,
} from './drawingml-colors';
import { base64, imageKey, imageType, MAX_IMAGE_BYTES } from './image-data';
import { metafileKind } from './metafile';
import {
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from './spreadsheet-document';
import type { XlsxArchive } from './xlsx-archive';
import { attributes, parse, relationships } from './xlsx-parts';
import {
  diagramShape,
  elementBuilder,
  readShape,
  shapeName,
  shapeSource,
  shapeXml,
  type XmlElement,
} from './xlsx-shapes';

export const EMU_PER_PIXEL = 9525;
const XDR =
  'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const CHART_NAMESPACE =
  'http://schemas.openxmlformats.org/drawingml/2006/chart';
const COMPATIBILITY =
  'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** All images of a workbook, at most. */
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
  // Metafiles are kept, and shown through a picture of them.
  const metafile = bytes && metafileKind(bytes);
  const type = bytes && (imageType(bytes) ?? (metafile && `x-${metafile}`));
  if (!bytes) key = undefined;
  else if (!type)
    warnings.add(
      'Images in formats Macro cannot read, such as TIFF, are not imported.'
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

/** A namespace prefix as it is matched in a pattern. */
const escaped = (prefix: string) => prefix.replace(/[.]/g, '\\.');

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
  if (drawing) source = resolveSchemeColors(source, drawing, theme);
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
  radarChart: 'radar',
  bubbleChart: 'bubble',
  stockChart: 'stock',
  surfaceChart: 'surface',
  surface3DChart: 'surface',
};
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
  // Whether the chart is linked to a pivot table, from its parser callbacks.
  const linked = { pivot: false };
  // Fixed values a series reads instead of cells, as they are read.
  let literal:
    | {
        kind: 'number' | 'text';
        points: Map<number, string>;
        count: number;
        at: number;
      }
    | undefined;
  /** The child of the series an element is inside, such as `tx` or `val`. */
  const seriesPart = () => {
    const index = stack.lastIndexOf('ser');
    return index < 0 ? undefined : stack[index + 1];
  };
  /** Record a data source, in document order, as what its series reads. */
  const source = (reference: string) => {
    references.push(reference);
    const index = references.length - 1;
    const part = series && seriesPart();
    if (series && part === 'tx') series.nameRef = index;
    else if (series && (part === 'cat' || part === 'xVal'))
      series.categories = index;
    else if (series && (part === 'val' || part === 'yVal'))
      series.values = index;
    else if (series && part === 'bubbleSize') series.sizes = index;
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
        else if (node.local === 'pivotSource') linked.pivot = true;
        else if (node.local === 'numLit' || node.local === 'strLit')
          literal = {
            kind: node.local === 'numLit' ? 'number' : 'text',
            points: new Map(),
            count: 0,
            at: 0,
          };
        else if (literal && node.local === 'ptCount')
          literal.count = Number(value.val) || 0;
        else if (literal && node.local === 'pt')
          literal.at = Number(value.idx) || 0;
        else if (literal && node.local === 'v') text = '';
        else if (parent === 'plotArea' && CHART_TYPES[node.local]) {
          const kind = CHART_TYPES[node.local];
          plot = {
            local: node.local,
            plot: { kind: kind === 'bar' ? 'column' : kind, series: [] },
            axes: [],
          };
        } else if (plot && parent === plot.local) {
          if (node.local === 'barDir') plot.direction = value.val;
          else if (node.local === 'radarStyle' && value.val === 'filled')
            plot.plot.filled = true;
          else if (node.local === 'hiLowLines') plot.plot.hiLow = true;
          else if (node.local === 'upDownBars') plot.plot.upDown = true;
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
        source(text.trim());
        text = undefined;
      } else if (literal && node.local === 'v' && text !== undefined) {
        literal.points.set(literal.at, text);
        text = undefined;
      } else if (
        literal &&
        (node.local === 'numLit' || node.local === 'strLit')
      ) {
        const { kind, points, count } = literal;
        const length = Math.min(
          100_000,
          Math.max(count, ...[...points.keys()].map((index) => index + 1))
        );
        const values = Array.from({ length }, (_, index) => {
          const text = points.get(index) ?? '';
          const number = text.trim() === '' ? Number.NaN : Number(text);
          return Number.isFinite(number) ? { text, number } : { text };
        });
        literal = undefined;
        source(chartLiteral(values, kind));
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
  const xml = new TextDecoder().decode(bytes);
  const kept = chartSource(xml, theme);
  if (!kept)
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
    ...(linked.pivot && { pivot: true as const }),
    ...(kept && { source: kept }),
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
    | {
        type: 'shape';
        builder: ReturnType<typeof elementBuilder>;
        element?: XmlElement;
      }
    | {
        type: 'diagram';
        name?: string;
        /** The diagram's data part, which names its drawing. */
        data?: string;
        extent?: { cx: number; cy: number };
      }
    | { type: 'other' };
};

/** Markup compatibility's elements, which wrap content and its fallback. */
const WRAPPERS = new Set(['AlternateContent', 'Choice', 'Fallback']);

/** A SmartArt drawing part, at most. */
const MAX_DIAGRAM_BYTES = 4 * 1024 * 1024;
const DIAGRAM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';

/** SmartArt's drawing part, through its data part's link to it. */
function diagramDrawing(
  archive: XlsxArchive,
  relations: ReturnType<typeof relationships>,
  data: string | undefined
): XmlElement | undefined {
  const dataPath = data ? relations.get(data) : undefined;
  const dataBytes =
    dataPath && !dataPath.external ? archive.read(dataPath.target) : undefined;
  if (!dataBytes) return;
  const id = /dataModelExt\b[^>]*\brelId="([^"]+)"/.exec(
    new TextDecoder().decode(dataBytes)
  )?.[1];
  const target = id ? relations.get(id) : undefined;
  if (!target || target.external) return;
  const bytes = archive.read(target.target);
  if (!bytes || bytes.length > MAX_DIAGRAM_BYTES) return;
  const builder = elementBuilder();
  let root: XmlElement | undefined;
  parse(bytes, target.target, (parser) => {
    parser.on('opentag', (node) => builder.start(node));
    parser.on('text', (chunk) => builder.text(chunk));
    parser.on('closetag', () => {
      root = builder.end() ?? root;
    });
  });
  return root;
}

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
  /** A drawing's size in EMU, from its anchor. */
  extent: (placement: {
    from: DrawingPoint;
    to?: DrawingPoint;
    width?: number;
    height?: number;
  }) => { cx: number; cy: number };
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
  // A graphic frame's size, read before it is known to hold SmartArt.
  let frameExtent: { cx: number; cy: number } | undefined;
  const stack: string[] = [];
  const finish = (value: PendingAnchor) => {
    const content = value.content;
    if (!content || content.type === 'other') {
      unsupported = true;
      return;
    }
    if (content.type === 'shape' && !content.element) {
      skipped++;
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
    const name =
      content.type === 'shape' ? shapeName(content.element) : content.name;
    const placement = {
      id: `drawing-${drawings.length + 1}`,
      ...(name && { name: name.slice(0, 256) }),
      from,
      ...(to
        ? { to }
        : { width: pixels(extent!.cx), height: pixels(extent!.cy) }),
    };
    if (content.type === 'shape') {
      const shape =
        content.element && readShape(content.element, options.theme);
      if (!shape || !content.element) {
        skipped++;
        return;
      }
      const source = shapeSource(content.element, options.theme);
      // A line anchored with no height (or width) draws flat, however
      // slightly Excel slanted it.
      const size = options.extent(placement);
      drawings.push({
        ...placement,
        type: 'shape',
        shape: {
          parts: shape.parts.map((part) => ({
            ...part,
            ...(size.cx === 0 && { x: 0, width: 0 }),
            ...(size.cy === 0 && { y: 0, height: 0 }),
          })),
          ...(source && { source }),
        },
      });
      return;
    }
    if (content.type === 'diagram') {
      const drawing = diagramDrawing(archive, relations, content.data);
      // The frame's size in EMU, else the anchor's.
      const frame =
        content.extent && content.extent.cx > 0 && content.extent.cy > 0
          ? content.extent
          : extent && extent.cx > 0 && extent.cy > 0
            ? extent
            : options.extent(placement);
      const shape =
        drawing &&
        diagramShape(
          drawing,
          { width: frame.cx, height: frame.cy },
          options.theme,
          content.name ?? 'Diagram'
        );
      if (shape) drawings.push({ ...placement, type: 'shape', shape });
      else unsupported = true;
      return;
    }
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
      // Newer content's fallback stands where the content would.
      const parent = stack.findLast((local) => !WRAPPERS.has(local));
      stack.push(node.local);
      if (node.uri === COMPATIBILITY && node.local === 'Choice') {
        choiceDepth++;
        return;
      }
      if (choiceDepth) return;
      // A shape is kept whole, to read and to export.
      if (anchor?.content?.type === 'shape' && anchor.content.builder.open) {
        anchor.content.builder.start(node);
        return;
      }
      if (
        node.uri === XDR &&
        ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(
          node.local
        ) &&
        !anchor
      ) {
        anchor = { kind: node.local, editAs: value.editAs };
        frameExtent = undefined;
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
          else if (['sp', 'grpSp', 'cxnSp'].includes(node.local)) {
            const builder = elementBuilder();
            builder.start(node);
            anchor.content = { type: 'shape', builder };
          } else if (node.local === 'contentPart')
            anchor.content = { type: 'other' };
        } else if (
          node.local === 'cNvPr' &&
          anchor.content &&
          anchor.content.type !== 'other' &&
          anchor.content.type !== 'shape'
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
        anchor.content =
          value.uri === DIAGRAM
            ? { type: 'diagram', name: anchor.content.name }
            : { type: 'other' };
      else if (
        node.uri === DRAWING &&
        node.local === 'ext' &&
        parent === 'xfrm' &&
        (anchor.content?.type === 'chart' || anchor.content?.type === 'diagram')
      ) {
        if (anchor.content.type === 'diagram')
          anchor.content.extent = {
            cx: Number(value.cx) || 0,
            cy: Number(value.cy) || 0,
          };
        else
          frameExtent = {
            cx: Number(value.cx) || 0,
            cy: Number(value.cy) || 0,
          };
      } else if (
        node.uri === DIAGRAM &&
        node.local === 'relIds' &&
        anchor.content?.type === 'diagram'
      ) {
        anchor.content.data = value.dm;
        anchor.content.extent ??= frameExtent;
      } else if (
        node.uri === CHART_NAMESPACE &&
        node.local === 'chart' &&
        anchor.content?.type === 'chart'
      )
        anchor.content.id = value.id;
    });
    parser.on('text', (chunk) => {
      if (text !== undefined) text += chunk;
      else if (
        !choiceDepth &&
        anchor?.content?.type === 'shape' &&
        anchor.content.builder.open
      )
        anchor.content.builder.text(chunk);
    });
    parser.on('closetag', (node) => {
      stack.pop();
      if (node.uri === COMPATIBILITY && node.local === 'Choice') {
        choiceDepth--;
        return;
      }
      if (choiceDepth || !anchor) return;
      if (anchor.content?.type === 'shape' && anchor.content.builder.open) {
        const element = anchor.content.builder.end();
        if (element) anchor.content.element = element;
        return;
      }
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
    warnings.add(
      'Ink, and SmartArt without a saved drawing, are not imported.'
    );
  if (skipped)
    warnings.add(
      'Some images and charts could not be placed and are not imported.'
    );
  return drawings;
}

// Export -------------------------------------------------------------------

/** A cell a chart reads, with the Excel number format it displays with. */
export type CellChartValue = ChartValue & { format?: string };
export type ChartValues = (reference: string) => CellChartValue[] | undefined;

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

/** The number format of the first number among values, as Excel caches it. */
const numberFormat = (values: CellChartValue[] | undefined) =>
  values?.find((value) => value.number !== undefined)?.format || 'General';

/** Points of a cache or of fixed values, as Excel writes them. */
function points(
  prefix: string,
  kind: 'number' | 'text',
  values: CellChartValue[]
): string {
  const element = (local: string) => `${prefix}${local}`;
  const items = values
    .map((value, index) =>
      kind === 'number'
        ? value.number === undefined
          ? ''
          : `<${element('pt')} idx="${index}"><${element('v')}>${numberText(value.number)}</${element('v')}></${element('pt')}>`
        : value.text
          ? `<${element('pt')} idx="${index}"><${element('v')}>${xml(value.text)}</${element('v')}></${element('pt')}>`
          : ''
    )
    .join('');
  return kind === 'number'
    ? `<${element('formatCode')}>${xml(numberFormat(values))}</${element('formatCode')}><${element('ptCount')} val="${values.length}"/>${items}`
    : `<${element('ptCount')} val="${values.length}"/>${items}`;
}

/** Cached values Excel and viewers draw from until they recalculate. */
function cache(
  prefix: string,
  kind: 'numRef' | 'strRef',
  values: CellChartValue[] | undefined
): string {
  if (!values?.length) return '';
  const local = kind === 'numRef' ? 'numCache' : 'strCache';
  return `<${prefix}${local}>${points(prefix, kind === 'numRef' ? 'number' : 'text', values)}</${prefix}${local}>`;
}

/**
 * A data source of a chart part: a reference with a cache of its values,
 * or fixed values. `kind` is the element the part had.
 */
function dataSource(
  prefix: string,
  kind: string,
  reference: string,
  values: ChartValues,
  name?: string
): string {
  const numeric = kind === 'numRef' || kind === 'numLit';
  const literal = parseChartLiteral(reference);
  if (literal)
    return numeric
      ? `<${prefix}numLit>${points(prefix, 'number', literal)}</${prefix}numLit>`
      : `<${prefix}strLit>${points(prefix, 'text', literal)}</${prefix}strLit>`;
  const formula = `<${prefix}f>${xml(reference)}</${prefix}f>`;
  if (kind === 'multiLvlStrRef')
    return `<${prefix}multiLvlStrRef>${formula}</${prefix}multiLvlStrRef>`;
  const element = numeric ? 'numRef' : 'strRef';
  const cached = name === undefined ? values(reference) : [{ text: name }];
  return `<${prefix}${element}>${formula}${cache(prefix, element, cached)}</${prefix}${element}>`;
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
  const name = (local: string) => `${escaped(prefix)}${local}`;
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
  // Each data source in order is a reference; a pivot chart's series
  // names are cached as its pivot table shows them.
  const sources = new RegExp(
    `<${escaped(prefix)}(numRef|strRef|multiLvlStrRef|numLit|strLit)\\b[^>]*>[\\s\\S]*?</${escaped(prefix)}\\1>`,
    'g'
  );
  if ((source.match(sources) ?? []).length !== chart.references.length) return;
  const names = new Map(
    chart.pivot && linked && pivotExists(linked.sheet, linked.name)
      ? chart.plots.flatMap((plot) =>
          plot.series.flatMap((series) =>
            series.nameRef !== undefined && series.name !== undefined
              ? [[series.nameRef, series.name] as const]
              : []
          )
        )
      : []
  );
  let index = 0;
  const withCaches = source.replace(
    sources,
    (_, kind: string, offset: number, whole: string) => {
      const at = index++;
      const reference = chart.references[at];
      const literal = parseChartLiteral(reference);
      // A name or title holds one text, not a list of values.
      const before = whole.slice(Math.max(0, offset - 200), offset);
      const named = new RegExp(`<${escaped(prefix)}tx>\\s*$`).test(before);
      if (literal && named) {
        const text = literal
          .map((value) => value.text.trim())
          .filter(Boolean)
          .join(' ');
        return new RegExp(
          `<${escaped(prefix)}title>\\s*<${escaped(prefix)}tx>\\s*$`
        ).test(before)
          ? `<${prefix}rich xmlns:a="${DRAWING}"><a:bodyPr/><a:p><a:r><a:t>${xml(text)}</a:t></a:r></a:p></${prefix}rich>`
          : `<${prefix}v>${xml(text)}</${prefix}v>`;
      }
      // Labels may be text even where the part read numbers.
      const labels =
        literal &&
        literal.some(
          (value) => value.text !== '' && value.number === undefined
        ) &&
        new RegExp(`<${escaped(prefix)}(?:cat|xVal)>\\s*$`).test(before);
      return dataSource(
        prefix,
        labels ? 'strLit' : kind,
        reference,
        values,
        names.get(at)
      );
    }
  );
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${withCaches}`;
}

/** The id of a surface chart's series axis. */
const SERIES_AXIS = 5;

/** A chart part made from what Macro knows of the chart. */
function generatedChart(chart: SheetChart, values: ChartValues): string {
  const reference = (index: number | undefined, kind: 'numRef' | 'strRef') =>
    index === undefined
      ? ''
      : dataSource('c:', kind, chart.references[index], values);
  const palette = chart.colors ?? themeAccents([]);
  let seriesIndex = 0;
  // Excel opens a stock chart of three or four series only; others are
  // written as lines.
  const plots = chart.plots.map((plot) =>
    plot.kind === 'stock' && (plot.series.length < 3 || plot.series.length > 4)
      ? { ...plot, kind: 'line' as const }
      : plot
  );
  const groups = plots.map((plot) => {
    const axes = plot.secondary ? [3, 4] : [1, 2];
    const series = plot.series
      .map((value) => {
        const index = seriesIndex++;
        const color = (value.color ?? palette[index % palette.length]).slice(1);
        const solid = `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
        const lined =
          plot.kind === 'line' ||
          plot.kind === 'scatter' ||
          (plot.kind === 'radar' && !plot.filled);
        const fill = lined
          ? `<c:spPr><a:ln w="28575" cap="rnd">${value.noLine ? '<a:noFill/>' : solid}<a:round/></a:ln></c:spPr>`
          : plot.kind === 'stock'
            ? // Prices are drawn by high-low lines and up-down bars.
              '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>'
            : plot.kind === 'pie' ||
                plot.kind === 'doughnut' ||
                plot.kind === 'surface'
              ? ''
              : `<c:spPr>${value.noFill ? '<a:noFill/>' : solid}</c:spPr>`;
        // A fixed name is written as its text.
        const fixed =
          value.nameRef === undefined
            ? undefined
            : parseChartLiteral(chart.references[value.nameRef])
                ?.map((item) => item.text.trim())
                .filter(Boolean)
                .join(' ');
        const label = fixed ?? value.name;
        const name =
          value.nameRef !== undefined && fixed === undefined
            ? `<c:tx>${reference(value.nameRef, 'strRef')}</c:tx>`
            : label
              ? `<c:tx><c:v>${xml(label)}</c:v></c:tx>`
              : '';
        const xy = plot.kind === 'scatter' || plot.kind === 'bubble';
        const categories = xy
          ? value.categories === undefined
            ? ''
            : `<c:xVal>${reference(value.categories, 'numRef')}</c:xVal>`
          : value.categories === undefined
            ? ''
            : `<c:cat>${reference(value.categories, 'strRef')}</c:cat>`;
        const numbers = xy
          ? `<c:yVal>${reference(value.values, 'numRef')}</c:yVal>${
              plot.kind === 'bubble'
                ? `<c:bubbleSize>${reference(value.sizes ?? value.values, 'numRef')}</c:bubbleSize><c:bubble3D val="0"/>`
                : ''
            }`
          : `<c:val>${reference(value.values, 'numRef')}</c:val>`;
        const marker =
          plot.kind === 'stock'
            ? '<c:marker><c:symbol val="none"/></c:marker>'
            : plot.kind === 'line' ||
                plot.kind === 'scatter' ||
                (plot.kind === 'radar' && !plot.filled)
              ? '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>'
              : '';
        const inverted =
          plot.kind === 'column' ||
          plot.kind === 'bar' ||
          plot.kind === 'bubble';
        const smooth =
          plot.kind === 'line' ||
          plot.kind === 'scatter' ||
          plot.kind === 'stock';
        return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${name}${fill}${inverted ? '<c:invertIfNegative val="0"/>' : ''}${marker}${categories}${numbers}${smooth ? '<c:smooth val="0"/>' : ''}</c:ser>`;
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
          `<c:scatterChart><c:scatterStyle val="${plot.series.every((value) => value.noLine) ? 'marker' : 'lineMarker'}"/><c:varyColors val="0"/>${series}${axisIds}</c:scatterChart>`
      )
      .with(
        'radar',
        () =>
          `<c:radarChart><c:radarStyle val="${plot.filled ? 'filled' : 'marker'}"/><c:varyColors val="0"/>${series}${axisIds}</c:radarChart>`
      )
      .with(
        'bubble',
        () =>
          `<c:bubbleChart><c:varyColors val="0"/>${series}<c:bubbleScale val="100"/><c:showNegBubbles val="0"/>${axisIds}</c:bubbleChart>`
      )
      .with(
        'stock',
        () =>
          `<c:stockChart>${series}${plot.hiLow ? '<c:hiLowLines/>' : ''}${plot.upDown ? '<c:upDownBars><c:gapWidth val="150"/><c:upBars/><c:downBars/></c:upDownBars>' : ''}${axisIds}</c:stockChart>`
      )
      .with(
        'surface',
        () =>
          `<c:surfaceChart><c:wireframe val="0"/>${series}${axisIds}<c:axId val="${SERIES_AXIS}"/></c:surfaceChart>`
      )
      .exhaustive();
  });
  const axisPairs = [false, true].flatMap((secondary) => {
    const plot = plots.find(
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
    const xy = plot.kind === 'scatter' || plot.kind === 'bubble';
    // Axes format their labels like the cells, as Excel saves them.
    const formatOf = (index: number | undefined) =>
      xml(
        index === undefined
          ? 'General'
          : numberFormat(
              parseChartLiteral(chart.references[index]) ??
                values(chart.references[index])
            )
      );
    const categoryFormat = formatOf(plot.series[0]?.categories);
    const valueFormat =
      plot.grouping === 'percentStacked'
        ? '0%'
        : formatOf(plot.series[0]?.values);
    // A stock chart's dates are categories, evenly spaced as Macro draws them.
    const automatic = plot.kind === 'stock' ? 0 : 1;
    const categoryAxis = xy
      ? `<c:valAx><c:axId val="${category}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${secondary ? 1 : 0}"/><c:axPos val="b"/><c:numFmt formatCode="${categoryFormat}" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${value}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
      : `<c:catAx><c:axId val="${category}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${secondary ? 1 : 0}"/><c:axPos val="${categoryPosition}"/><c:numFmt formatCode="${categoryFormat}" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${value}"/><c:crosses val="autoZero"/><c:auto val="${automatic}"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
    const valueAxis = `<c:valAx><c:axId val="${value}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${valuePosition}"/>${secondary ? '' : '<c:majorGridlines/>'}<c:numFmt formatCode="${valueFormat}" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${category}"/><c:crosses val="${secondary ? 'max' : 'autoZero'}"/><c:crossBetween val="${xy || plot.kind === 'surface' ? 'midCat' : 'between'}"/></c:valAx>`;
    // A surface also has an axis of its series.
    const seriesAxis =
      plot.kind === 'surface'
        ? `<c:serAx><c:axId val="${SERIES_AXIS}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${value}"/><c:crosses val="autoZero"/></c:serAx>`
        : '';
    return [categoryAxis, valueAxis, seriesAxis];
  });
  const title = chart.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const legend = chart.legend
    ? `<c:legend><c:legendPos val="${chart.legend[0]}"/><c:overlay val="0"/></c:legend>`
    : '';
  // A surface seen from above, as Excel saves contour charts.
  const view = plots.some((plot) => plot.kind === 'surface')
    ? '<c:view3D><c:rotX val="90"/><c:rotY val="0"/><c:rAngAx val="0"/><c:perspective val="0"/></c:view3D>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${CHART_NAMESPACE}" xmlns:a="${DRAWING}" xmlns:r="${RELATIONSHIPS}"><c:roundedCorners val="0"/><c:chart>${title}${view}<c:plotArea><c:layout/>${groups.join('')}${axisPairs.join('')}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
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
  'x-emf': 'emf',
  'x-wmf': 'wmf',
};

/** An image's bytes and file extension from its data URL. */
export function imageFile(
  url: string
): { bytes: Uint8Array; extension: string } | undefined {
  const match = /^data:image\/([a-z-]+);base64,(.*)$/.exec(url);
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
 * chart part; `size` a drawing's size in pixels, for picture extents; and
 * `origin` a corner's distance in pixels from the sheet's top-left corner.
 */
export function drawingPart(options: {
  drawings: SheetDrawing[];
  image: (key: string) => string | undefined;
  chart: (chart: SheetChart) => string;
  size: (
    drawing: SheetDrawing,
    minimum?: number
  ) => { width: number; height: number };
  origin: (point: DrawingPoint) => { x: number; y: number };
}): { xml: string; rels: string } | undefined {
  const relations: string[] = [];
  const anchors: string[] = [];
  // Shape ids are unique within the part; a group numbers each member.
  let nextId = 2;
  const takeId = () => nextId++;
  options.drawings.forEach((drawing, index) => {
    let content: string;
    if (drawing.type === 'shape') {
      const corner = options.origin(drawing.from);
      // A straight line may have no height or no width.
      const { width, height } = options.size(drawing, 0);
      content = shapeXml(
        drawing.shape,
        {
          x: corner.x * EMU_PER_PIXEL,
          y: corner.y * EMU_PER_PIXEL,
          width: width * EMU_PER_PIXEL,
          height: height * EMU_PER_PIXEL,
        },
        takeId,
        drawing.name ?? `Shape ${index + 1}`
      );
    } else if (drawing.type === 'image') {
      const id = takeId();
      const path = options.image(drawing.image);
      if (!path) return;
      relations.push(
        `<Relationship Id="rId${relations.length + 1}" Type="${RELATIONSHIPS}/image" Target="../${path.replace(/^xl\//, '')}"/>`
      );
      const { width, height } = options.size(drawing);
      content = `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${xml(drawing.name ?? `Picture ${index + 1}`)}"${drawing.description ? ` descr="${xml(drawing.description)}"` : ''}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${relations.length}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(width * EMU_PER_PIXEL)}" cy="${Math.round(height * EMU_PER_PIXEL)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
    } else {
      const id = takeId();
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
