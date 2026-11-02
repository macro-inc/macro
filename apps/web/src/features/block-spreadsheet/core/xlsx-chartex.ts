import {
  type ChartBinning,
  type ChartKind,
  type ChartPlot,
  type ChartSeries,
  chartLiteral,
  MAX_CHART_SOURCE_LENGTH,
  parseChartLiteral,
  parseChartReference,
  type SheetChart,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { match } from 'ts-pattern';
import { DEFAULT_GAP_WIDTHS } from './chart-shapes';
import {
  finishColor,
  type PendingColor,
  resolveSchemeColors,
  schemeColor,
  themeAccents,
} from './drawingml-colors';
import {
  type CellChartValue,
  type ChartValues,
  numberFormat,
  numberText,
  xml,
} from './xlsx-chart-values';
import { attributes, parse } from './xlsx-parts';

/** Excel 2016's chart namespace, for histograms, waterfalls, treemaps... */
export const CHARTEX =
  'http://schemas.microsoft.com/office/drawing/2014/chartex';
export const CHARTEX_RELATIONSHIP =
  'http://schemas.microsoft.com/office/2014/relationships/chartEx';
export const CHARTEX_CONTENT_TYPE = 'application/vnd.ms-office.chartex+xml';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const RELATIONSHIPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Each kind's series layout, as chartEx parts name it. */
const LAYOUTS = {
  histogram: 'clusteredColumn',
  pareto: 'clusteredColumn',
  waterfall: 'waterfall',
  funnel: 'funnel',
  boxWhisker: 'boxWhisker',
  treemap: 'treemap',
  sunburst: 'sunburst',
} as const satisfies Partial<Record<ChartKind, string>>;
type ChartExKind = keyof typeof LAYOUTS;

const isChartExKind = (kind: ChartKind): kind is ChartExKind => kind in LAYOUTS;

/** Whether Excel saves a chart as a chartEx part. */
export const isChartEx = (chart: SheetChart) =>
  chart.plots.some((plot) => isChartExKind(plot.kind));

/**
 * The compatibility namespace a chartEx frame requires, as Excel writes it:
 * funnels came in a later revision than the others.
 */
export function chartExRequirement(chart: SheetChart): {
  prefix: string;
  namespace: string;
} {
  return chart.plots.some((plot) => plot.kind === 'funnel')
    ? {
        prefix: 'cx2',
        namespace:
          'http://schemas.microsoft.com/office/drawing/2015/10/21/chartex',
      }
    : {
        prefix: 'cx1',
        namespace:
          'http://schemas.microsoft.com/office/drawing/2015/9/8/chartex',
      };
}

/** Whether chart part bytes are a chartEx part. */
export const isChartExPart = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.subarray(0, 4_096)).includes(CHARTEX);

/** The prefix a part gives a namespace, `''` when it is the default. */
function namespacePrefix(source: string, uri: string): string | undefined {
  const escaped = uri.replace(/[.]/g, '\\.');
  const named = new RegExp(`xmlns:([A-Za-z_][\\w.-]*)="${escaped}"`).exec(
    source
  );
  if (named) return `${named[1]}:`;
  if (new RegExp(`xmlns="${escaped}"`).test(source)) return '';
}

const pattern = (prefix: string) => prefix.replace(/[.]/g, '\\.');

/**
 * The chartEx part as Macro keeps it for export: without cached values,
 * which export writes again. Undefined when it refers to other parts or is
 * too large.
 */
function chartExSource(
  xml: string,
  theme: (string | undefined)[]
): string | undefined {
  const prefix = namespacePrefix(xml, CHARTEX);
  if (prefix === undefined) return;
  const name = (local: string) => `${pattern(prefix)}${local}`;
  let source = xml
    .replace(/^<\?xml[^>]*>\s*/, '')
    .replace(new RegExp(`<${name('lvl')}\\b[^>]*/>`, 'g'), '')
    .replace(
      new RegExp(`<${name('lvl')}\\b[^>]*>[\\s\\S]*?</${name('lvl')}>`, 'g'),
      ''
    )
    .replace(new RegExp(`<${name('externalData')}\\b[^>]*/>`, 'g'), '')
    .replace(
      new RegExp(
        `<${name('externalData')}\\b[^>]*>[\\s\\S]*?</${name('externalData')}>`,
        'g'
      ),
      ''
    );
  if (/\br:(?:id|embed|link)=/.test(source)) return;
  const drawing = namespacePrefix(source, DRAWING);
  if (drawing)
    source = resolveSchemeColors(source, drawing.slice(0, -1), theme);
  return source.length <= MAX_CHART_SOURCE_LENGTH ? source : undefined;
}

type PendingDimension = {
  type: string;
  numeric: boolean;
  reference?: number;
  /** Values cached in the first level, for data without a formula. */
  cached: Map<number, string>;
  count: number;
  levels: number;
};

type PendingSeries = {
  layout: string;
  hidden: boolean;
  dataId?: string;
  nameRef?: number;
  name?: string;
  color?: string;
  labels: boolean;
  aggregate: boolean;
  binning?: ChartBinning;
  totals: number[];
  visibility: Record<string, string>;
  quartiles?: string;
  parentLabels?: string;
};

const LEGENDS = {
  r: 'right',
  l: 'left',
  t: 'top',
  b: 'bottom',
} as const;

const finite = (text: string | undefined) => {
  const value = Number(text);
  return text !== undefined && text.trim() !== '' && Number.isFinite(value)
    ? value
    : undefined;
};

/**
 * Read a chartEx part into what Macro draws, keeping the part for export.
 * Undefined for kinds Macro does not draw, such as region maps, so the
 * drawing's fallback is read instead.
 */
export function readChartEx(
  bytes: Uint8Array,
  path: string,
  theme: (string | undefined)[],
  warnings: Set<string>
): SheetChart | undefined {
  const references: string[] = [];
  const data = new Map<string, PendingDimension[]>();
  const series: PendingSeries[] = [];
  const stack: string[] = [];
  let dimensions: PendingDimension[] | undefined;
  let dimension: PendingDimension | undefined;
  let current: PendingSeries | undefined;
  let text: string | undefined;
  let point = 0;
  let title: string | undefined;
  let titleSeen = false;
  // The chart's own title's depth in `stack`, not an axis title's.
  let titleDepth: number | undefined;
  let legend: SheetChart['legend'];
  let gapWidth: number | undefined;
  let literalData = false;
  let color: PendingColor | undefined;
  let colorDepth: number | undefined;
  const inside = (local: string) => stack.includes(local);
  const inTitle = () => titleDepth !== undefined;
  parse(bytes, path, (parser) => {
    parser.on('opentag', (node) => {
      const value = attributes(node);
      const parent = stack.at(-1);
      stack.push(node.local);
      if (node.uri === DRAWING) {
        if (node.local === 't' && inTitle()) text = '';
        else if (
          current &&
          colorDepth !== undefined &&
          parent === 'solidFill'
        ) {
          if (node.local === 'srgbClr')
            color = { hex: value.val, modifiers: [] };
          else if (node.local === 'schemeClr')
            color = { hex: schemeColor(theme, value.val ?? ''), modifiers: [] };
        } else if (color && value.val !== undefined)
          color.modifiers.push([node.local, Number(value.val)]);
        return;
      }
      if (node.uri !== CHARTEX) return;
      match(node.local)
        .with('data', () => {
          dimensions = [];
          data.set(value.id ?? '', dimensions);
        })
        .with('numDim', 'strDim', (local) => {
          dimension = {
            type: value.type ?? '',
            numeric: local === 'numDim',
            cached: new Map(),
            count: 0,
            levels: 0,
          };
          dimensions?.push(dimension);
        })
        .with('lvl', () => {
          if (dimension && !dimension.levels++)
            dimension.count = Number(value.ptCount) || 0;
        })
        .with('pt', () => {
          point = Number(value.idx) || 0;
          if (dimension?.levels === 1) text = '';
        })
        .with('f', 'v', () => {
          text = '';
        })
        .with('title', () => {
          if (parent !== 'chart') return;
          titleSeen = true;
          titleDepth = stack.length;
        })
        .with('legend', () => {
          legend = LEGENDS[value.pos as keyof typeof LEGENDS] ?? 'right';
        })
        .with('catScaling', () => {
          const gap = finite(value.gapWidth);
          if (gap !== undefined) gapWidth = Math.round(gap * 100);
        })
        .with('series', () => {
          current = {
            layout: value.layoutId ?? '',
            hidden: value.hidden === '1' || value.hidden === 'true',
            labels: false,
            aggregate: false,
            totals: [],
            visibility: {},
          };
        })
        .with('dataId', () => {
          if (current) current.dataId = value.val;
        })
        .with('spPr', () => {
          if (current && parent === 'series') colorDepth = stack.length;
        })
        .with('dataLabels', () => {
          if (current) current.labels = true;
        })
        .with('visibility', () => {
          if (!current) return;
          if (parent === 'dataLabels') current.labels = value.value !== '0';
          else current.visibility = value;
        })
        .with('aggregation', () => {
          if (current) current.aggregate = true;
        })
        .with('binning', () => {
          if (!current) return;
          const underflow = finite(value.underflow);
          const overflow = finite(value.overflow);
          current.binning = {
            ...(underflow !== undefined && { underflow }),
            ...(overflow !== undefined && { overflow }),
            ...(value.intervalClosed === 'l' && { closedLeft: true as const }),
          };
        })
        .with('binSize', () => {
          const size = finite(value.val);
          if (current?.binning && size !== undefined && size > 0)
            current.binning.size = size;
        })
        .with('binCount', () => {
          const count = Number(value.val);
          if (current?.binning && Number.isInteger(count) && count >= 1)
            current.binning.count = Math.min(1_000, count);
        })
        .with('statistics', () => {
          if (current) current.quartiles = value.quartileMethod;
        })
        .with('idx', () => {
          const index = Number(value.val);
          // Points a sheet can hold, as plots validate them.
          if (
            current &&
            parent === 'subtotals' &&
            Number.isInteger(index) &&
            index >= 0 &&
            index < 100_000 &&
            current.totals.length < 100_000
          )
            current.totals.push(index);
        })
        .with('parentLabelLayout', () => {
          if (current) current.parentLabels = value.val;
        })
        .otherwise(() => undefined);
    });
    parser.on('text', (chunk) => {
      if (text !== undefined) text += chunk;
    });
    parser.on('closetag', (node) => {
      stack.pop();
      if (node.uri === DRAWING) {
        if (node.local === 't' && text !== undefined) {
          title = (title ?? '') + text;
          text = undefined;
        } else if (
          color &&
          (node.local === 'srgbClr' || node.local === 'schemeClr')
        ) {
          if (current && /^[0-9a-f]{6}$/i.test(color.hex ?? ''))
            current.color ??= finishColor(color);
          color = undefined;
        }
        return;
      }
      if (node.uri !== CHARTEX) return;
      match(node.local)
        .with('f', () => {
          if (text === undefined) return;
          references.push(text.trim());
          const index = references.length - 1;
          if (dimension) dimension.reference = index;
          else if (current && inside('tx')) current.nameRef = index;
          text = undefined;
        })
        .with('pt', () => {
          if (dimension && text !== undefined)
            dimension.cached.set(point, text);
          text = undefined;
        })
        .with('v', () => {
          if (text === undefined) return;
          if (current && inside('tx')) current.name = text.trim();
          else if (inTitle()) title ??= text;
          text = undefined;
        })
        .with('numDim', 'strDim', () => {
          // Data without a formula is kept as fixed values.
          if (dimension && dimension.reference === undefined) {
            literalData = true;
            const length = Math.min(
              100_000,
              Math.max(
                dimension.count,
                ...[...dimension.cached.keys()].map((index) => index + 1)
              )
            );
            const values = Array.from({ length }, (_, index) => {
              const cell = dimension?.cached.get(index) ?? '';
              const number = finite(cell);
              return number === undefined
                ? { text: cell }
                : { text: cell, number };
            });
            references.push(
              chartLiteral(values, dimension.numeric ? 'number' : 'text')
            );
            dimension.reference = references.length - 1;
          }
          dimension = undefined;
        })
        .with('title', () => {
          if (titleDepth !== undefined && stack.length < titleDepth)
            titleDepth = undefined;
        })
        .with('spPr', () => {
          if (colorDepth !== undefined && stack.length < colorDepth)
            colorDepth = undefined;
        })
        .with('series', () => {
          if (current) series.push(current);
          current = undefined;
          colorDepth = undefined;
        })
        .otherwise(() => undefined);
    });
  });
  const shown = series.filter(
    (value) => !value.hidden && value.layout !== 'paretoLine'
  );
  const first = shown[0];
  const kind = first && kindOf(first.layout, series);
  if (!first || !kind) {
    warnings.add(
      'Some Excel 2016 charts, such as maps, are imported as the picture Excel saved for older versions.'
    );
    return;
  }
  const plotSeries: ChartSeries[] = shown.flatMap((value) => {
    if (LAYOUTS[kind] !== value.layout) return [];
    const dims = data.get(value.dataId ?? '0') ?? [];
    const values = dims.find(
      (dim) => dim.type === 'val' || dim.type === 'size'
    )?.reference;
    if (values === undefined) return [];
    const categories = dims.find((dim) => dim.type === 'cat')?.reference;
    return [
      {
        ...(value.name && { name: value.name }),
        ...(value.nameRef !== undefined && { nameRef: value.nameRef }),
        ...(categories !== undefined && { categories }),
        values,
        ...(value.color && { color: value.color }),
      },
    ];
  });
  const plot: ChartPlot = {
    kind,
    ...plotOptions(kind, first, gapWidth),
    series: plotSeries,
  };
  if (titleSeen && title === undefined && plotSeries.length === 1)
    title = plotSeries[0].name;
  const kept = literalData
    ? undefined
    : chartExSource(new TextDecoder().decode(bytes), theme);
  if (!kept)
    warnings.add(
      'Some charts keep only their data and type; their formatting is not exported.'
    );
  const shownTitle = titleSeen ? title?.trim() : undefined;
  return {
    ...(shownTitle && { title: shownTitle }),
    ...(legend && { legend }),
    plots: [plot],
    references,
    colors: themeAccents(theme),
    ...(kept && { source: kept }),
  };
}

function kindOf(
  layout: string,
  series: PendingSeries[]
): ChartExKind | undefined {
  if (layout === 'clusteredColumn')
    return series.some((value) => value.layout === 'paretoLine')
      ? 'pareto'
      : 'histogram';
  return (Object.keys(LAYOUTS) as ChartExKind[]).find(
    (kind) =>
      kind !== 'histogram' && kind !== 'pareto' && LAYOUTS[kind] === layout
  );
}

/** A chartEx series' layout options, as a plot keeps those its kind takes. */
function plotOptions(
  kind: ChartExKind,
  series: PendingSeries,
  gapWidth: number | undefined
): Omit<ChartPlot, 'kind' | 'series'> {
  const gap =
    gapWidth !== undefined && gapWidth >= 0 && gapWidth <= 500
      ? { gapWidth }
      : {};
  const visible = (key: string, fallback: boolean) =>
    series.visibility[key] === undefined
      ? fallback
      : series.visibility[key] === '1' || series.visibility[key] === 'true';
  return match(kind)
    .with('histogram', 'pareto', () => ({
      ...(series.aggregate
        ? { aggregate: true as const }
        : series.binning &&
          Object.keys(series.binning).length && { binning: series.binning }),
      ...gap,
    }))
    .with('waterfall', () => ({
      ...(series.totals.length && { totals: series.totals }),
      ...(!visible('connectorLines', true) && { noConnectors: true as const }),
      ...(series.labels && { labels: true as const }),
      ...gap,
    }))
    .with('funnel', () => ({
      ...(series.labels && { labels: true as const }),
      ...gap,
    }))
    .with('boxWhisker', () => ({
      ...(series.quartiles === 'inclusive' && {
        quartiles: 'inclusive' as const,
      }),
      ...(visible('meanLine', false) && { meanLine: true as const }),
      ...(!visible('meanMarker', true) && { noMeanMarkers: true as const }),
      ...(visible('nonoutliers', false) && { innerPoints: true as const }),
      ...(!visible('outliers', true) && { noOutliers: true as const }),
      ...gap,
    }))
    .with('treemap', () =>
      match(series.parentLabels)
        .with('banner', 'none', (parentLabels) => ({ parentLabels }))
        .otherwise(() => ({}))
    )
    .with('sunburst', () => ({}))
    .exhaustive();
}

// Export -------------------------------------------------------------------

/**
 * Cached levels of a data dimension: numbers in one level, or labels in a
 * level per column (per row, for a wide block), innermost first.
 */
function levels(
  reference: string,
  numeric: boolean,
  values: CellChartValue[] | undefined
): string {
  const cells = values ?? [];
  const point = (value: CellChartValue, index: number) =>
    numeric
      ? value.number === undefined
        ? ''
        : `<cx:pt idx="${index}">${numberText(value.number)}</cx:pt>`
      : value.text === ''
        ? ''
        : `<cx:pt idx="${index}">${xml(value.text)}</cx:pt>`;
  if (numeric)
    return `<cx:lvl ptCount="${cells.length}" formatCode="${xml(numberFormat(cells))}">${cells.map(point).join('')}</cx:lvl>`;
  const range = parseChartReference(reference);
  const width = range ? range.right - range.left + 1 : 1;
  const height = range ? range.bottom - range.top + 1 : cells.length;
  const across = height >= width;
  const count = across ? height : width;
  const depth = across ? width : height;
  return Array.from({ length: depth }, (_, level) => depth - 1 - level)
    .map((level) => {
      const column = Array.from(
        { length: count },
        (_, index) =>
          cells[across ? index * width + level : level * width + index] ?? {
            text: '',
          }
      );
      return `<cx:lvl ptCount="${count}">${column.map(point).join('')}</cx:lvl>`;
    })
    .join('');
}

/**
 * The chartEx part Macro kept, with its references as they are now and
 * caches of their current values. Undefined if it no longer matches them.
 */
function keptChartEx(
  chart: SheetChart,
  values: ChartValues
): string | undefined {
  const source = chart.source;
  const prefix = source && namespacePrefix(source, CHARTEX);
  if (!source || prefix === undefined) return;
  const name = (local: string) => `${pattern(prefix)}${local}`;
  const formulas = new RegExp(
    `(<${name('f')}\\b[^>]*>)[\\s\\S]*?</${name('f')}>(\\s*<${name('v')}>[\\s\\S]*?</${name('v')}>)?`,
    'g'
  );
  if ((source.match(formulas) ?? []).length !== chart.references.length) return;
  let index = 0;
  let broken = false;
  const written = source.replace(
    formulas,
    (
      _,
      open: string,
      cachedName: string | undefined,
      offset: number,
      whole: string
    ) => {
      const reference = chart.references[index++];
      if (parseChartLiteral(reference)) broken = true;
      const read = values(reference);
      const before = whole.slice(Math.max(0, offset - 200), offset);
      const dimension = new RegExp(
        `<${pattern(prefix)}(numDim|strDim)\\b[^>]*>\\s*$`
      ).exec(before);
      const formula = `${open}${xml(reference)}</${prefix}f>`;
      if (dimension)
        return `${formula}${levels(reference, dimension[1] === 'numDim', read).replaceAll('cx:', prefix)}`;
      // A series name caches the text its cells show now.
      if (cachedName === undefined) return formula;
      const text = (read ?? [])
        .map((value) => value.text.trim())
        .filter(Boolean)
        .join(' ');
      return `${formula}<${prefix}v>${xml(text)}</${prefix}v>`;
    }
  );
  if (broken) return;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${written}`;
}

/** A data dimension's formula and cache, or fixed values without one. */
function dimensionXml(
  element: 'numDim' | 'strDim',
  type: string,
  reference: string,
  values: ChartValues
): string {
  const literal = parseChartLiteral(reference);
  if (literal)
    return `<cx:${element} type="${type}">${levels('', element === 'numDim', literal)}</cx:${element}>`;
  return `<cx:${element} type="${type}"><cx:f>${xml(reference)}</cx:f>${levels(reference, element === 'numDim', values(reference))}</cx:${element}>`;
}

/** A series' layout options, in the order the chartEx schema lists them. */
function layoutXml(plot: ChartPlot): string {
  const flag = (on: boolean | undefined) => (on ? '1' : '0');
  const body = match(plot.kind)
    .with('histogram', 'pareto', () => {
      if (plot.aggregate) return '<cx:aggregation/>';
      const binning = plot.binning ?? {};
      const edges = `${binning.underflow === undefined ? '' : ` underflow="${numberText(binning.underflow)}"`}${binning.overflow === undefined ? '' : ` overflow="${numberText(binning.overflow)}"`}`;
      const width =
        binning.size !== undefined
          ? `<cx:binSize val="${numberText(binning.size)}"/>`
          : binning.count !== undefined
            ? `<cx:binCount val="${binning.count}"/>`
            : '';
      return `<cx:binning intervalClosed="${binning.closedLeft ? 'l' : 'r'}"${edges}>${width}</cx:binning>`;
    })
    .with(
      'waterfall',
      () =>
        `<cx:visibility connectorLines="${flag(!plot.noConnectors)}"/>${
          plot.totals?.length
            ? `<cx:subtotals>${plot.totals.map((index) => `<cx:idx val="${index}"/>`).join('')}</cx:subtotals>`
            : ''
        }`
    )
    .with(
      'boxWhisker',
      () =>
        `<cx:visibility meanLine="${flag(plot.meanLine)}" meanMarker="${flag(!plot.noMeanMarkers)}" nonoutliers="${flag(plot.innerPoints)}" outliers="${flag(!plot.noOutliers)}"/><cx:statistics quartileMethod="${plot.quartiles ?? 'exclusive'}"/>`
    )
    .with(
      'treemap',
      () =>
        `<cx:parentLabelLayout val="${plot.parentLabels ?? 'overlapping'}"/>`
    )
    .otherwise(() => '');
  return body ? `<cx:layoutPr>${body}</cx:layoutPr>` : '';
}

/** A chartEx part made from what Macro knows of the chart. */
function generatedChartEx(chart: SheetChart, values: ChartValues): string {
  const plot = chart.plots.find((value) => isChartExKind(value.kind));
  if (!plot || !isChartExKind(plot.kind)) return '';
  const kind = plot.kind;
  // Histograms, pareto charts, waterfalls, treemaps and sunbursts show one
  // series, as Excel's do.
  const shown =
    kind === 'funnel' || kind === 'boxWhisker'
      ? plot.series
      : plot.series.slice(0, 1);
  const data = shown
    .map((series, index) => {
      const categories =
        series.categories === undefined
          ? ''
          : dimensionXml(
              'strDim',
              'cat',
              chart.references[series.categories],
              values
            );
      const sized = kind === 'treemap' || kind === 'sunburst';
      return `<cx:data id="${index}">${categories}${dimensionXml('numDim', sized ? 'size' : 'val', chart.references[series.values], values)}</cx:data>`;
    })
    .join('');
  const pareto = kind === 'pareto';
  const series = shown
    .map((value, index) => {
      const reference =
        value.nameRef === undefined
          ? undefined
          : chart.references[value.nameRef];
      const fixed =
        reference === undefined
          ? undefined
          : parseChartLiteral(reference)
              ?.map((item) => item.text.trim())
              .filter(Boolean)
              .join(' ');
      const read =
        reference === undefined || fixed !== undefined
          ? undefined
          : (values(reference) ?? [])
              .map((item) => item.text.trim())
              .filter(Boolean)
              .join(' ');
      const text = fixed ?? (read || value.name);
      const name =
        reference !== undefined && fixed === undefined
          ? `<cx:tx><cx:txData><cx:f>${xml(reference)}</cx:f>${text ? `<cx:v>${xml(text)}</cx:v>` : ''}</cx:txData></cx:tx>`
          : text
            ? `<cx:tx><cx:txData><cx:v>${xml(text)}</cx:v></cx:txData></cx:tx>`
            : '';
      const fill = value.color
        ? `<cx:spPr><a:solidFill><a:srgbClr val="${value.color.slice(1)}"/></a:solidFill></cx:spPr>`
        : '';
      const labels =
        plot.labels && (kind === 'waterfall' || kind === 'funnel')
          ? `<cx:dataLabels pos="${kind === 'funnel' ? 'ctr' : 'outEnd'}"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels>`
          : '';
      return `<cx:series layoutId="${LAYOUTS[kind]}" uniqueId="{00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}}">${name}${fill}${labels}<cx:dataId val="${index}"/>${layoutXml(plot)}${pareto ? '<cx:axisId val="1"/>' : ''}</cx:series>`;
    })
    .join('');
  const line = pareto
    ? `<cx:series layoutId="paretoLine" ownerIdx="0" uniqueId="{00000000-0000-4000-8000-100000000001}"><cx:axisId val="2"/></cx:series>`
    : '';
  const gap = (plot.gapWidth ?? DEFAULT_GAP_WIDTHS[kind] ?? 0) / 100;
  const categoryAxis = `<cx:axis id="0"><cx:catScaling gapWidth="${numberText(gap)}"/><cx:tickLabels/></cx:axis>`;
  const axes = match(kind)
    .with('treemap', 'sunburst', () => '')
    .with('funnel', () => categoryAxis)
    .otherwise(
      () =>
        `${categoryAxis}<cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>${
          pareto
            ? '<cx:axis id="2"><cx:valScaling max="1" min="0"/><cx:units unit="percentage"/><cx:tickLabels/></cx:axis>'
            : ''
        }`
    );
  const title = chart.title
    ? `<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>${xml(chart.title)}</cx:v></cx:txData></cx:tx></cx:title>`
    : '';
  const legend = chart.legend
    ? `<cx:legend pos="${chart.legend[0]}" align="ctr" overlay="0"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cx:chartSpace xmlns:a="${DRAWING}" xmlns:r="${RELATIONSHIPS}" xmlns:cx="${CHARTEX}"><cx:chartData>${data}</cx:chartData><cx:chart>${title}<cx:plotArea><cx:plotAreaRegion>${series}${line}</cx:plotAreaRegion>${axes}</cx:plotArea>${legend}</cx:chart></cx:chartSpace>`;
}

/** A chartEx part for export: the one imported when it still fits. */
export function chartExPart(chart: SheetChart, values: ChartValues): string {
  return keptChartEx(chart, values) ?? generatedChartEx(chart, values);
}
