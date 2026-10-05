import {
  type CellSelection,
  selectionBounds,
} from '@macro-inc/spreadsheet/grid-selection';
import {
  type DrawingPlacement,
  parseChartReference,
  type SheetChart,
  type SheetDrawing,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { type Accessor, createSignal } from 'solid-js';
import type { WorkbookCalculation } from '../core/calculation';
import {
  type ChartLayout,
  type ChartSettings,
  type ChartTypeId,
  chartFromLayout,
  chartLayout,
  chartType,
  dataRegion,
  guessLayout,
  withChartType,
} from '../core/chart-builder';
import { createChartReader } from '../core/chart-data';
import { MAX_IMAGE_BYTES, storedImage } from '../core/image-data';
import {
  formatCellAddress,
  SPREADSHEET_MAX_COLUMNS,
} from '../core/spreadsheet-document';
import type { SpreadsheetStore } from './create-spreadsheet-store';

/** A new chart's size: Excel's 5 by 3 inches at 96 dots per inch. */
const CHART_SIZE = { width: 480, height: 288 };
/** A new image fits in this box at 100% zoom. */
const IMAGE_BOX = { width: 640, height: 480 };

const quoteSheet = (name: string) => `'${name.replaceAll("'", "''")}'`;

function rangeText(sheet: string, home: string, layout: ChartLayout) {
  const start = formatCellAddress(layout.range.top, layout.range.left);
  const end = formatCellAddress(layout.range.bottom, layout.range.right);
  const cells = start === end ? start : `${start}:${end}`;
  return sheet.toLowerCase() === home.toLowerCase()
    ? cells
    : `${quoteSheet(sheet)}!${cells}`;
}

/** A natural image size scaled to fit `IMAGE_BOX`. */
async function imageSize(file: Blob) {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    const ratio = Math.min(
      1,
      IMAGE_BOX.width / width,
      IMAGE_BOX.height / height
    );
    return {
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio)),
    };
  } catch {
    return { width: 320, height: 240 };
  }
}

/**
 * Creating, placing and changing the active sheet's images and charts. Each
 * change is one metadata write, so one undo step.
 */
export function createDrawingActions(options: {
  store: SpreadsheetStore;
  canEdit: Accessor<boolean>;
  selection: Accessor<CellSelection>;
  values: Accessor<WorkbookCalculation>;
  setNotice: (message: string) => void;
  /** Called with a new drawing, to select and show it. */
  onCreated: (id: string) => void;
}) {
  const [editing, setEditing] = createSignal<string>();
  const drawings = () => options.store.activeSheet().metadata?.drawings ?? [];
  const write = (next: SheetDrawing[], images?: Record<string, string>) => {
    const metadata = options.store.activeSheet().metadata;
    options.store.setMetadata(
      { ...metadata, drawings: next.length ? next : undefined },
      images
    );
  };
  const uniqueId = (prefix: string) => {
    const used = new Set(drawings().map((drawing) => drawing.id));
    for (;;) {
      const id = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
      if (!used.has(id)) return id;
    }
  };
  const nextName = (kind: string) => {
    const names = new Set(drawings().map((drawing) => drawing.name));
    for (let index = drawings().length + 1; ; index++)
      if (!names.has(`${kind} ${index}`)) return `${kind} ${index}`;
  };
  // Cells as charts read them: calculated values, or literal cells.
  const read = () =>
    createChartReader(
      options.store.workbook,
      options.values,
      options.store.activeSheetId()
    );

  function insertChart(type: ChartTypeId) {
    if (!options.canEdit()) return;
    const sheet = options.store.activeSheet();
    const reader = read();
    const value = (row: number, column: number) =>
      reader({ top: row, bottom: row, left: column, right: column })?.[0];
    const region = dataRegion(
      (row, column) =>
        !!sheet.cells[formatCellAddress(row, column)]?.value.trim(),
      selectionBounds(options.selection()),
      { rows: sheet.layout.rowCount, columns: sheet.layout.columnCount }
    );
    if (!region) {
      options.setNotice(
        'Select the cells to chart, or a cell in a table of data.'
      );
      return;
    }
    const chart = chartFromLayout(type, sheet.name, guessLayout(region, value));
    if (!chart) {
      options.setNotice('The selected cells have no values to chart.');
      return;
    }
    // A chart of one series is titled with its name, as in Excel.
    const series = chart.plots[0].series;
    const name =
      series.length === 1 && series[0].nameRef !== undefined
        ? reader(parseChartReference(chart.references[series[0].nameRef])!)
            ?.map((item) => item.text)
            .join(' ')
            .trim()
        : undefined;
    const id = uniqueId('chart');
    write([
      ...drawings(),
      {
        id,
        type: 'chart',
        name: nextName('Chart'),
        // Beside the data, as Excel places a new chart.
        from: {
          row: region.top,
          column: Math.min(SPREADSHEET_MAX_COLUMNS - 1, region.right + 2),
          x: 0,
          y: 0,
        },
        ...CHART_SIZE,
        chart: { ...chart, ...(name && { title: name }) },
      },
    ]);
    options.onCreated(id);
  }

  async function insertImage(file: File) {
    if (!options.canEdit()) return;
    if (file.size > MAX_IMAGE_BYTES) {
      options.setNotice('Choose an image up to 2 MB.');
      return;
    }
    const image = storedImage(new Uint8Array(await file.arrayBuffer()));
    if (!image) {
      options.setNotice('Choose a PNG, JPEG, GIF, WebP or BMP image.');
      return;
    }
    const size = await imageSize(file);
    const { anchor } = options.selection();
    const id = uniqueId('image');
    write(
      [
        ...drawings(),
        {
          id,
          type: 'image',
          name: nextName('Picture'),
          image: image.key,
          description: file.name.replace(/\.[^.]+$/, '').slice(0, 1_000),
          from: { row: anchor.row, column: anchor.column, x: 0, y: 0 },
          ...size,
        },
      ],
      { [image.key]: image.url }
    );
    options.onCreated(id);
  }

  function placeDrawing(id: string, placement: DrawingPlacement) {
    if (!options.canEdit()) return;
    write(
      drawings().map((drawing) =>
        drawing.id === id
          ? {
              ...drawing,
              from: placement.from,
              to: placement.to,
              width: placement.width,
              height: placement.height,
            }
          : drawing
      )
    );
  }

  function deleteDrawing(id: string) {
    if (!options.canEdit()) return;
    write(drawings().filter((drawing) => drawing.id !== id));
  }

  /** The dialog's settings for a chart. */
  function chartSettings(id: string): ChartSettings | undefined {
    const drawing = drawings().find((value) => value.id === id);
    if (drawing?.type !== 'chart') return;
    const home = options.store.activeSheet().name;
    const found = chartLayout(drawing.chart, home);
    return {
      type: chartType(drawing.chart),
      title: drawing.chart.title ?? '',
      legend: drawing.chart.legend ?? 'none',
      range: found ? rangeText(found.sheet, home, found.layout) : '',
      orientation: found?.layout.orientation ?? 'columns',
      firstRow: found?.layout.firstRow ?? true,
      firstColumn: found?.layout.firstColumn ?? true,
    };
  }

  /**
   * Apply the dialog to a chart. Its data is read again from the range when
   * the range or its reading changed. Macro then writes the chart on export,
   * in place of the part Excel saved. Returns an error to show, if any.
   */
  function applyChart(id: string, settings: ChartSettings): string | undefined {
    if (!options.canEdit()) return;
    const drawing = drawings().find((value) => value.id === id);
    if (drawing?.type !== 'chart') return;
    const before = chartSettings(id);
    const home = options.store.activeSheet().name;
    let chart: SheetChart = drawing.chart;
    const dataChanged =
      !!before &&
      (settings.range.trim() !== before.range ||
        settings.orientation !== before.orientation ||
        settings.firstRow !== before.firstRow ||
        settings.firstColumn !== before.firstColumn);
    if (dataChanged) {
      const target = parseChartReference(settings.range.trim());
      if (!target) return 'Enter the cells to chart, like A1:C7.';
      const rebuilt = chartFromLayout(
        settings.type ?? 'column',
        target.sheet ?? home,
        {
          range: target,
          orientation: settings.orientation,
          firstRow: settings.firstRow,
          firstColumn: settings.firstColumn,
        },
        chart
      );
      if (!rebuilt)
        return 'Those cells have no values beside their names and labels.';
      chart = rebuilt;
    } else if (settings.type && settings.type !== before?.type)
      chart = withChartType(chart, settings.type);
    const { source: _source, pivot: _pivot, ...rest } = chart;
    write(
      drawings().map((value) =>
        value.id === id
          ? {
              ...value,
              chart: {
                ...rest,
                title: settings.title.trim() || undefined,
                legend:
                  settings.legend === 'none' ? undefined : settings.legend,
              },
            }
          : value
      )
    );
  }

  return {
    editing,
    setEditing,
    insertChart,
    insertImage,
    placeDrawing,
    deleteDrawing,
    chartSettings,
    applyChart,
  };
}
