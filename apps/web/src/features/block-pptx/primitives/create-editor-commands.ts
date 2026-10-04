/**
 * Everything the editor can do, as named commands shared by the ribbon,
 * context menus, and keyboard shortcuts. Each command reads the current
 * selection (shapes, text, or table cells) and turns intent into engine
 * operations.
 */

import type {
  BorderEdges,
  BulletSpec,
  CellRef,
  ChartGrouping,
  ChartSeriesData,
  EditableChartKind,
  EditOp,
  FillSpec,
  LinePatch,
  NewShape,
  ParaPatch,
  RunPatch,
  ShapeOutline,
  SlideOutline,
  TransitionPatch,
} from '@core/pptx-engine/types';
import type { PptxEditorContext } from '../context/pptx-editor-context';
import { formatState, stepFontSize } from '../core/formatting';
import { modulate } from '../core/palette';
import {
  type AlignMode,
  alignOps,
  reorderOps,
  rotateOps,
  sizeOps,
} from '../core/selection';
import { formatCommand, paragraphCommand } from '../core/text-commands';
import type { PresentationSession } from './create-presentation-session';
import type { SlideEditor } from './create-slide-editor';

export interface EditorCommandsOptions {
  session: PresentationSession;
  editor: SlideEditor;
  context: PptxEditorContext;
  slideSize: () => { w: number; h: number };
  /** Returns keyboard focus to the text being edited, or the stage. */
  refocus: () => void;
  /** Starts typing into a shape (after inserting a text box). */
  startEditing: (shape: number) => void;
  /** The table cells commands act on: the edited cell or a selected range. */
  tableTarget: () => TableTarget | undefined;
}

/** A table and the cell range table commands act on (inclusive). */
export interface TableTarget {
  shape: ShapeOutline;
  from: CellRef;
  to: CellRef;
}

async function fileToBase64(file: Blob): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export type TextToggle = 'bold' | 'italic' | 'underline' | 'strike';

export function createEditorCommands(options: EditorCommandsOptions) {
  const { session, editor, context } = options;
  const slide = () => session.currentSlide();
  const canEdit = () => context.canEdit();

  const apply = async (ops: EditOp[], group?: string) => {
    if (ops.length === 0) return null;
    return session.apply(ops, group);
  };

  // ---- text ----------------------------------------------------------------

  const format = () => {
    const src = editor.formatSource();
    return formatState(src.layout, src.range);
  };
  /** The paragraph style at the caret (or the shape's first paragraph). */
  const paragraphStyle = () => {
    const src = editor.formatSource();
    const p = src.range?.[0].paragraph ?? 0;
    return src.layout?.styles[p];
  };
  /** Text formatting applies: text is edited, or text shapes or cells are selected. */
  const textActive = () =>
    !!editor.editing() ||
    editor.selection().some((s) => s.textEditable) ||
    !!options.tableTarget();

  /** The selected cell range, when formatting goes to cells. */
  const cellRange = () =>
    editor.editing() ? undefined : options.tableTarget();
  const runs = (props: RunPatch) => {
    if (cellRange()) return formatCells(props);
    return editor
      .formatWith((t, range) => formatCommand(t, range, props))
      .then(options.refocus);
  };
  const paragraphs = (props: ParaPatch) => {
    if (cellRange())
      return tableOp((slideId, t) =>
        cellsOf(t).map((cell) => ({
          op: 'formatParagraphs' as const,
          slide: slideId,
          shape: t.shape.id,
          cell,
          props,
        }))
      );
    return editor
      .formatWith((t, range) => paragraphCommand(t, range, props))
      .then(options.refocus);
  };

  const toggle = (key: TextToggle) => runs({ [key]: !format()[key] });
  const setFont = (font: string) => runs({ font });
  const setFontSize = (size: number) =>
    runs({ size: Math.max(1, Math.min(4000, size)) });
  const stepSize = (direction: 1 | -1) =>
    setFontSize(stepFontSize(format().size ?? 18, direction));
  const setTextColor = (color: string) => runs({ color });
  const setHighlight = (color: string | null) =>
    runs({ highlight: color ?? '' });
  const toggleBaseline = (kind: 'super' | 'sub') => {
    const current = format().baseline ?? 0;
    const target = kind === 'super' ? 30 : -25;
    return runs({
      baseline: Math.sign(current) === Math.sign(target) ? 0 : target,
    });
  };
  const clearFormatting = () =>
    runs({
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      baseline: 0,
      highlight: '',
    });
  const setLink = (url: string) => runs({ link: url });

  const align = (value: NonNullable<ParaPatch['align']>) =>
    paragraphs({ align: value });
  const setBullets = (bullet: BulletSpec) => paragraphs({ bullet });
  const toggleBullets = () =>
    setBullets(
      format().bullet ? { kind: 'none' } : { kind: 'char', char: '•' }
    );
  const toggleNumbering = () =>
    setBullets(
      format().bullet
        ? { kind: 'none' }
        : { kind: 'number', scheme: 'arabicPeriod', start: 1 }
    );
  const indent = (direction: 1 | -1) => {
    const level = paragraphStyle()?.level ?? 0;
    return paragraphs({
      level: Math.max(0, Math.min(8, level + direction)),
    });
  };
  const lineSpacing = (multiple: number) =>
    paragraphs({ lineSpacing: multiple });
  const spacing = (before?: number, after?: number) =>
    paragraphs({
      ...(before !== undefined ? { spaceBefore: before } : {}),
      ...(after !== undefined ? { spaceAfter: after } : {}),
    });

  /** Text box settings for the edited shape (or cell), or every selected one. */
  const body = async (
    props: Extract<EditOp, { op: 'formatBody' }>['props']
  ) => {
    const s = slide();
    if (!s) return;
    if (cellRange()) {
      await tableOp((slideId, t) =>
        cellsOf(t).map((cell) => ({
          op: 'formatBody' as const,
          slide: slideId,
          shape: t.shape.id,
          cell,
          props,
        }))
      );
      return;
    }
    const edit = editor.editing();
    if (edit) {
      await apply([
        {
          op: 'formatBody',
          slide: s.id,
          shape: edit.shape,
          ...(edit.cell ? { cell: edit.cell } : {}),
          props,
        },
      ]);
      await editor.refreshEditing();
      options.refocus();
      return;
    }
    await apply(
      editor
        .selection()
        .filter((x) => x.textEditable)
        .map((x) => ({
          op: 'formatBody' as const,
          slide: s.id,
          shape: x.id,
          props,
        }))
    );
  };

  // ---- shapes ----------------------------------------------------------------

  /** The shapes shape formatting applies to. */
  const targets = (): ShapeOutline[] => {
    const edit = editor.editing();
    if (edit) {
      const shape = editor.findShape(edit.shape);
      return shape && !edit.cell ? [shape] : [];
    }
    return editor.selection();
  };
  const each = (build: (slide: number, shape: ShapeOutline) => EditOp) => {
    const s = slide();
    if (!s) return Promise.resolve(null);
    return apply(targets().map((shape) => build(s.id, shape)));
  };

  const setFill = (fill: FillSpec) =>
    each((s, shape) => ({ op: 'setFill', slide: s, shape: shape.id, fill }));
  const fillColor = (color: string | null) =>
    setFill(color ? { kind: 'solid', color } : { kind: 'none' });
  const setLine = (line: LinePatch) =>
    each((s, shape) => ({ op: 'setLine', slide: s, shape: shape.id, line }));
  const setGeometry = (preset: string) =>
    each((s, shape) => ({
      op: 'setGeometry',
      slide: s,
      shape: shape.id,
      preset,
    }));

  const arrange = (to: 'front' | 'back' | 'forward' | 'backward') => {
    const s = slide();
    if (!s) return;
    void apply(reorderOps(s.id, targets(), s.shapes, to));
  };
  const alignShapes = (mode: AlignMode, toSlide = false) => {
    const s = slide();
    if (!s) return;
    void apply(alignOps(s.id, targets(), mode, options.slideSize(), toSlide));
  };
  const rotate = (change: 'right90' | 'left90' | 'flipH' | 'flipV') => {
    const s = slide();
    if (!s) return;
    void apply(rotateOps(s.id, targets(), change));
  };
  const resize = (size: { w?: number; h?: number }) => {
    const s = slide();
    if (!s) return;
    void apply(sizeOps(s.id, targets(), size));
  };
  const move = (at: { x?: number; y?: number }) =>
    each((s, shape) => ({
      op: 'setTransform',
      slide: s,
      shape: shape.id,
      ...at,
    }));
  const setRotation = (rotation: number) =>
    each((s, shape) => ({
      op: 'setTransform',
      slide: s,
      shape: shape.id,
      rotation: ((rotation % 360) + 360) % 360,
    }));

  /** PowerPoint-like quick styles from a theme color. */
  const styleShapes = async (
    kind: 'solid' | 'outline' | 'light',
    color: string
  ) => {
    const s = slide();
    const deck = session.outline();
    if (!s || !deck) return;
    const css =
      deck.themeColors.find(
        ([slot]) => slot === (color === 'tx1' ? 'dk1' : color)
      )?.[1] ?? '#000000';
    const hex = css.replace('#', '');
    const ops: EditOp[] = [];
    for (const shape of targets()) {
      const fill: FillSpec =
        kind === 'solid'
          ? { kind: 'solid', color }
          : kind === 'light'
            ? { kind: 'solid', color: modulate(hex, 0.2, 0.8) }
            : { kind: 'solid', color: 'bg1' };
      ops.push({ op: 'setFill', slide: s.id, shape: shape.id, fill });
      ops.push({
        op: 'setLine',
        slide: s.id,
        shape: shape.id,
        line: {
          color: kind === 'solid' ? modulate(hex, 0.75) : color,
          width: 1,
        },
      });
      if (shape.textEditable)
        ops.push({
          op: 'formatText',
          slide: s.id,
          shape: shape.id,
          props: {
            color:
              kind === 'solid' ? 'bg1' : kind === 'outline' ? color : 'tx1',
          },
        });
    }
    await apply(ops);
  };

  const selectAll = () => {
    if (editor.editing()) editor.selectAllText();
    else editor.selectAll();
  };

  // ---- insertion -------------------------------------------------------------

  const centered = (w: number, h: number) => {
    const size = options.slideSize();
    return { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h };
  };
  const insert = async (
    shape: NewShape,
    box: { x: number; y: number; w: number; h: number }
  ) => {
    const s = slide();
    if (!s) return undefined;
    const result = await apply([
      { op: 'addShape', slide: s.id, shape, ...box },
    ]);
    return result?.created[0]?.shape;
  };

  const insertTextBox = async (box = centered(300, 40)) => {
    const id = await insert({ kind: 'textBox', text: '' }, box);
    if (id !== undefined) options.startEditing(id);
  };
  const insertShape = async (preset: string, box = centered(200, 120)) => {
    const id =
      preset === 'line' || preset === 'arrow'
        ? await insert({ kind: 'line', arrow: preset === 'arrow' }, box)
        : await insert({ kind: 'shape', preset }, box);
    if (id !== undefined) editor.select(id);
    options.refocus();
    return id;
  };
  const insertImage = async (file: Blob, name = 'Picture') => {
    try {
      const bitmap = await createImageBitmap(file);
      const natural = { w: bitmap.width * 0.75, h: bitmap.height * 0.75 };
      bitmap.close();
      const size = options.slideSize();
      const fit = Math.min(
        1,
        (size.w * 0.6) / natural.w,
        (size.h * 0.6) / natural.h
      );
      const data = await fileToBase64(file);
      const id = await insert(
        { kind: 'image', data, description: name },
        centered(natural.w * fit, natural.h * fit)
      );
      if (id !== undefined) editor.select(id);
    } catch {
      context.notifyError('That picture could not be inserted.');
    }
  };
  // ---- charts ----------------------------------------------------------------

  /** The one selected chart. */
  const chartShape = () => {
    const shape = editor.selectedShape();
    return shape?.kind === 'chart' ? shape : undefined;
  };
  const formatChart = (
    change: Omit<
      Extract<EditOp, { op: 'formatChart' }>,
      'op' | 'slide' | 'shape'
    >
  ) => {
    const s = slide();
    const chart = chartShape();
    if (!s || !chart) return Promise.resolve(null);
    return apply([
      { op: 'formatChart', slide: s.id, shape: chart.id, ...change },
    ]);
  };
  const setChartType = (kind: EditableChartKind, grouping?: ChartGrouping) => {
    const s = slide();
    const chart = chartShape();
    if (!s || !chart) return Promise.resolve(null);
    return apply([
      {
        op: 'setChartType',
        slide: s.id,
        shape: chart.id,
        kind,
        ...(grouping ? { grouping } : {}),
      },
    ]);
  };
  const setChartData = (
    shape: number,
    data: { categories: string[]; series: ChartSeriesData[] }
  ) => {
    const s = slide();
    if (!s) return Promise.resolve(null);
    return apply([{ op: 'setChartData', slide: s.id, shape, ...data }]);
  };
  const insertChart = async (
    chartType: EditableChartKind,
    grouping: ChartGrouping | undefined,
    data: { categories: string[]; series: ChartSeriesData[] }
  ) => {
    const size = options.slideSize();
    const id = await insert(
      {
        kind: 'chart',
        chartType,
        ...(grouping ? { grouping } : {}),
        ...data,
        title: 'Chart title',
      },
      centered(Math.min(size.w * 0.6, 560), Math.min(size.h * 0.6, 320))
    );
    if (id !== undefined) editor.select(id);
    return id;
  };

  /** Replaces the selected picture's image, keeping its frame. */
  const replaceImage = async (file: Blob) => {
    const s = slide();
    const picture = editor.selectedShape();
    if (!s || picture?.kind !== 'picture') return;
    try {
      const data = await fileToBase64(file);
      await apply([
        { op: 'replaceImage', slide: s.id, shape: picture.id, data },
      ]);
    } catch {
      context.notifyError('That picture could not be used.');
    }
  };
  const insertTable = async (rows = 3, cols = 3) => {
    const size = options.slideSize();
    const cells = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => '')
    );
    const w = Math.min(size.w * 0.8, cols * 120);
    const id = await insert({ kind: 'table', cells }, centered(w, rows * 30));
    if (id !== undefined) editor.select(id);
  };

  // ---- slides ----------------------------------------------------------------

  const goToSlideId = (id: number) => {
    const index = session.outline()?.slides.findIndex((s) => s.id === id) ?? -1;
    if (index >= 0) editor.goToSlide(index);
  };
  const addSlide = async (layout?: string, after = slide()?.id) => {
    const result = await apply([
      { op: 'addSlide', after, ...(layout ? { layout } : {}) },
    ]);
    const id = result?.created[0]?.slide;
    if (id !== undefined) goToSlideId(id);
  };
  const duplicateSlide = async (id = slide()?.id) => {
    if (id === undefined) return;
    const result = await apply([{ op: 'duplicateSlide', slide: id }]);
    const created = result?.created[0]?.slide;
    if (created !== undefined) goToSlideId(created);
  };
  const deleteSlides = async (ids: number[]) => {
    const deck = session.outline();
    if (!deck || ids.length === 0 || ids.length >= deck.slides.length) return;
    editor.goToSlide(session.slideIndex());
    await apply(ids.map((slide) => ({ op: 'deleteSlide' as const, slide })));
  };
  const toggleHidden = (s: SlideOutline) =>
    apply([{ op: 'setSlideHidden', slide: s.id, hidden: !s.hidden }]);
  const moveSlide = async (id: number, to: number) => {
    await apply([{ op: 'moveSlide', slide: id, to }]);
    goToSlideId(id);
  };
  let lastBackground: FillSpec | null = null;
  const applyBackgroundToAll = () => {
    const deck = session.outline();
    if (!deck) return;
    void apply(
      deck.slides.map((x) => ({
        op: 'setBackground' as const,
        slide: x.id,
        fill: lastBackground ?? undefined,
      }))
    );
  };
  const setBackground = (fill: FillSpec | null, all = false) => {
    const deck = session.outline();
    const s = slide();
    lastBackground = fill;
    if (!deck || !s) return;
    const ids = all ? deck.slides.map((x) => x.id) : [s.id];
    void apply(
      ids.map((id) => ({
        op: 'setBackground' as const,
        slide: id,
        fill: fill ?? undefined,
      }))
    );
  };

  // ---- tables ----------------------------------------------------------------

  /** The rows and columns a table range covers. */
  const span = (t: TableTarget) => ({
    rows: [
      Math.min(t.from.row, t.to.row),
      Math.max(t.from.row, t.to.row),
    ] as const,
    cols: [
      Math.min(t.from.col, t.to.col),
      Math.max(t.from.col, t.to.col),
    ] as const,
  });
  const tableOp = (build: (slide: number, t: TableTarget) => EditOp[]) => {
    const s = slide();
    const t = options.tableTarget();
    if (!s || !t) return Promise.resolve(null);
    editor.stopEditing();
    return apply(build(s.id, t));
  };
  const insertRows = (where: 'above' | 'below') =>
    tableOp((slideId, t) => {
      const { rows } = span(t);
      const count = rows[1] - rows[0] + 1;
      const at = where === 'above' ? rows[0] : rows[1] + 1;
      return Array.from({ length: count }, () => ({
        op: 'insertTableRow' as const,
        slide: slideId,
        shape: t.shape.id,
        at,
      }));
    });
  const insertColumns = (where: 'left' | 'right') =>
    tableOp((slideId, t) => {
      const { cols } = span(t);
      const count = cols[1] - cols[0] + 1;
      const at = where === 'left' ? cols[0] : cols[1] + 1;
      return Array.from({ length: count }, () => ({
        op: 'insertTableColumn' as const,
        slide: slideId,
        shape: t.shape.id,
        at,
      }));
    });
  const deleteRows = () =>
    tableOp((slideId, t) => {
      const { rows } = span(t);
      const total = t.shape.table?.rowHeights.length ?? 0;
      if (rows[1] - rows[0] + 1 >= total)
        return [{ op: 'deleteShape', slide: slideId, shape: t.shape.id }];
      // Bottom-up, so earlier deletions don't shift later indices.
      return Array.from({ length: rows[1] - rows[0] + 1 }, (_, i) => ({
        op: 'deleteTableRow' as const,
        slide: slideId,
        shape: t.shape.id,
        row: rows[1] - i,
      }));
    });
  const deleteColumns = () =>
    tableOp((slideId, t) => {
      const { cols } = span(t);
      const total = t.shape.table?.columnWidths.length ?? 0;
      if (cols[1] - cols[0] + 1 >= total)
        return [{ op: 'deleteShape', slide: slideId, shape: t.shape.id }];
      return Array.from({ length: cols[1] - cols[0] + 1 }, (_, i) => ({
        op: 'deleteTableColumn' as const,
        slide: slideId,
        shape: t.shape.id,
        col: cols[1] - i,
      }));
    });
  const deleteTable = () =>
    tableOp((slideId, t) => [
      { op: 'deleteShape', slide: slideId, shape: t.shape.id },
    ]);
  /** Every cell of the range (top-left of merges included once). */
  const cellsOf = (t: TableTarget): CellRef[] => {
    const { rows, cols } = span(t);
    const out: CellRef[] = [];
    for (let row = rows[0]; row <= rows[1]; row++)
      for (let col = cols[0]; col <= cols[1]; col++) out.push({ row, col });
    return out;
  };
  /** Paragraph alignment in each cell of the range. */
  const alignCells = (align: NonNullable<ParaPatch['align']>) =>
    tableOp((slideId, t) =>
      cellsOf(t).map((cell) => ({
        op: 'formatParagraphs' as const,
        slide: slideId,
        shape: t.shape.id,
        cell,
        props: { align },
      }))
    );
  /** Vertical alignment in each cell of the range. */
  const anchorCells = (anchor: 'top' | 'middle' | 'bottom') =>
    tableOp((slideId, t) => {
      const { rows, cols } = span(t);
      return [
        {
          op: 'formatCells' as const,
          slide: slideId,
          shape: t.shape.id,
          from: { row: rows[0], col: cols[0] },
          to: { row: rows[1], col: cols[1] },
          anchor,
        },
      ];
    });
  /** Character formatting in each cell of the range. */
  const formatCells = (props: RunPatch) =>
    tableOp((slideId, t) =>
      cellsOf(t).map((cell) => ({
        op: 'formatText' as const,
        slide: slideId,
        shape: t.shape.id,
        cell,
        props,
      }))
    );

  /** The range as a normalized rectangle. */
  const rect = (t: TableTarget) => {
    const { rows, cols } = span(t);
    return {
      from: { row: rows[0], col: cols[0] },
      to: { row: rows[1], col: cols[1] },
    };
  };
  const canMerge = () => {
    const t = options.tableTarget();
    if (!t) return false;
    const { rows, cols } = span(t);
    return rows[1] > rows[0] || cols[1] > cols[0];
  };
  const mergeCells = () =>
    tableOp((slideId, t) => [
      { op: 'mergeCells', slide: slideId, shape: t.shape.id, ...rect(t) },
    ]);
  /** Merged cells in the range (their anchors). */
  const mergesIn = (t: TableTarget): CellRef[] => {
    const cells = t.shape.table?.cells;
    if (!cells) return [];
    const { rows, cols } = span(t);
    const out: CellRef[] = [];
    for (let row = rows[0]; row <= rows[1]; row++)
      for (let col = cols[0]; col <= cols[1]; col++) {
        const c = cells[row]?.[col];
        if (c && !c.merged && (c.rowSpan > 1 || c.colSpan > 1))
          out.push({ row, col });
      }
    return out;
  };
  const canSplit = () => {
    const t = options.tableTarget();
    if (!t) return false;
    const { rows, cols } = span(t);
    const cells = t.shape.table?.cells;
    // A cell covered by a merge counts too.
    for (let row = rows[0]; row <= rows[1]; row++)
      for (let col = cols[0]; col <= cols[1]; col++) {
        const c = cells?.[row]?.[col];
        if (c && (c.merged || c.rowSpan > 1 || c.colSpan > 1)) return true;
      }
    return false;
  };
  const splitCells = () =>
    tableOp((slideId, t) => {
      const anchors = mergesIn(t);
      const list = anchors.length > 0 ? anchors : [rect(t).from];
      return list.map((cell) => ({
        op: 'splitCell' as const,
        slide: slideId,
        shape: t.shape.id,
        cell,
      }));
    });
  const fillCells = (color: string | null) =>
    tableOp((slideId, t) => [
      {
        op: 'formatCells',
        slide: slideId,
        shape: t.shape.id,
        ...rect(t),
        fill: color ? { kind: 'solid', color } : { kind: 'none' },
      },
    ]);
  /** The pen new borders are drawn with. */
  let pen: { color?: string; width?: number } = {};
  const setBorderPen = (change: { color?: string; width?: number }) => {
    pen = { ...pen, ...change };
  };
  const borderCells = (edges: string, none = false) =>
    tableOp((slideId, t) => [
      {
        op: 'formatCells',
        slide: slideId,
        shape: t.shape.id,
        ...rect(t),
        borders: {
          edges: edges as BorderEdges,
          line: none
            ? { none: true }
            : {
                color: pen.color ?? 'tx1',
                width: pen.width ?? 1,
                dash: 'solid',
              },
        },
      },
    ]);
  const setTableStyle = (
    change: Partial<{
      style: string;
      firstRow: boolean;
      lastRow: boolean;
      firstCol: boolean;
      lastCol: boolean;
      bandRow: boolean;
      bandCol: boolean;
    }>
  ) =>
    tableOp((slideId, t) => [
      { op: 'setTableStyle', slide: slideId, shape: t.shape.id, ...change },
    ]);
  /** Grid sizes with `change` applied to the range's rows/columns. */
  const gridOp = (
    slideId: number,
    t: TableTarget,
    widths: number[] | undefined,
    heights: number[] | undefined
  ): EditOp => ({
    op: 'setTableGrid',
    slide: slideId,
    shape: t.shape.id,
    ...(widths ? { columnWidths: widths } : {}),
    ...(heights ? { rowHeights: heights } : {}),
  });
  const cellSize = () => {
    const t = options.tableTarget();
    const table = t?.shape.table;
    if (!t || !table) return undefined;
    const { rows, cols } = span(t);
    return {
      w: table.columnWidths[cols[0]],
      h: (table.laidOutRowHeights ?? table.rowHeights)[rows[0]],
    };
  };
  const setCellSize = (size: { w?: number; h?: number }) =>
    tableOp((slideId, t) => {
      const table = t.shape.table;
      if (!table) return [];
      const { rows, cols } = span(t);
      const widths =
        size.w !== undefined
          ? table.columnWidths.map((w, i) =>
              i >= cols[0] && i <= cols[1] ? size.w! : w
            )
          : undefined;
      const heights =
        size.h !== undefined
          ? table.rowHeights.map((h, i) =>
              i >= rows[0] && i <= rows[1] ? size.h! : h
            )
          : undefined;
      return [gridOp(slideId, t, widths, heights)];
    });
  /** Evens out the range's rows (the whole table when one row is picked). */
  const distributeRows = () =>
    tableOp((slideId, t) => {
      const table = t.shape.table;
      if (!table) return [];
      let { rows } = span(t);
      if (rows[0] === rows[1]) rows = [0, table.rowHeights.length - 1];
      const drawn = table.laidOutRowHeights ?? table.rowHeights;
      const picked = drawn.slice(rows[0], rows[1] + 1);
      const even = picked.reduce((a, b) => a + b, 0) / picked.length;
      return [
        gridOp(
          slideId,
          t,
          undefined,
          table.rowHeights.map((h, i) =>
            i >= rows[0] && i <= rows[1] ? even : h
          )
        ),
      ];
    });
  const distributeColumns = () =>
    tableOp((slideId, t) => {
      const table = t.shape.table;
      if (!table) return [];
      let { cols } = span(t);
      if (cols[0] === cols[1]) cols = [0, table.columnWidths.length - 1];
      const picked = table.columnWidths.slice(cols[0], cols[1] + 1);
      const even = picked.reduce((a, b) => a + b, 0) / picked.length;
      return [
        gridOp(
          slideId,
          t,
          table.columnWidths.map((w, i) =>
            i >= cols[0] && i <= cols[1] ? even : w
          ),
          undefined
        ),
      ];
    });
  /**
   * Drags a column border (the next column gives up the space, as in
   * PowerPoint) or a row border (the row grows).
   */
  const resizeGrid = (
    shape: number,
    axis: 'col' | 'row',
    index: number,
    delta: number
  ) => {
    const s = slide();
    const table = editor.findShape(shape)?.table;
    if (!s || !table) return Promise.resolve(null);
    if (axis === 'col') {
      const widths = [...table.columnWidths];
      const next = index + 1 < widths.length ? index + 1 : undefined;
      const d =
        next === undefined
          ? Math.max(delta, 8 - widths[index])
          : Math.min(Math.max(delta, 8 - widths[index]), widths[next] - 8);
      widths[index] += d;
      if (next !== undefined) widths[next] -= d;
      return apply([
        { op: 'setTableGrid', slide: s.id, shape, columnWidths: widths },
      ]);
    }
    const drawn = table.laidOutRowHeights ?? table.rowHeights;
    const heights = table.rowHeights.map((h, i) =>
      i === index ? Math.max(8, drawn[i] + delta) : h
    );
    return apply([
      { op: 'setTableGrid', slide: s.id, shape, rowHeights: heights },
    ]);
  };

  // ---- grouping, layouts, transitions -----------------------------------------

  /** Groups the selected shapes (two or more). */
  const group = async () => {
    const s = slide();
    const list = editor.selection();
    if (!s || list.length < 2) return;
    const result = await apply([
      { op: 'groupShapes', slide: s.id, shapes: list.map((x) => x.id) },
    ]);
    const id = result?.created[0]?.shape;
    if (id !== undefined && id !== null) editor.select(id);
  };
  /** Ungroups every selected group, selecting their members. */
  const ungroup = async () => {
    const s = slide();
    const groups = editor.selection().filter((x) => x.kind === 'group');
    if (!s || groups.length === 0) return;
    const result = await apply(
      groups.map((g) => ({
        op: 'ungroupShape' as const,
        slide: s.id,
        shape: g.id,
      }))
    );
    const ids = (result?.created ?? [])
      .map((c) => c.shape)
      .filter((id): id is number => id !== undefined && id !== null);
    if (ids.length > 0) editor.setSelection(ids);
  };
  /** Gives the current slide another layout. */
  const setLayout = async (layout: string) => {
    const s = slide();
    if (!s) return;
    await apply([{ op: 'setSlideLayout', slide: s.id, layout }]);
  };
  /** Changes the current slide's transition (or every slide's). */
  const setTransition = (patch: Omit<TransitionPatch, 'slide'>) => {
    const s = slide();
    if (!s) return Promise.resolve(null);
    return apply([{ op: 'setTransition', slide: s.id, ...patch }]);
  };
  /** Recolors the whole deck with a theme color set. */
  const setThemeColors = (colors: Record<string, string>, name?: string) =>
    apply([
      {
        op: 'setThemeColors',
        colors: Object.entries(colors).map(([slot, color]) => ({
          slot,
          color,
        })),
        ...(name ? { name } : {}),
      },
    ]);
  /** Sets the deck's heading and body fonts. */
  const setThemeFonts = (major: string, minor: string, name?: string) =>
    apply([{ op: 'setThemeFonts', major, minor, ...(name ? { name } : {}) }]);
  /** Alt text of the one selected shape. */
  const setAltText = (text: string) => {
    const s = slide();
    const shape = editor.selectedShape();
    if (!s || !shape) return Promise.resolve(null);
    return apply([{ op: 'setAltText', slide: s.id, shape: shape.id, text }]);
  };

  return {
    canEdit,
    insertRows,
    insertColumns,
    deleteRows,
    deleteColumns,
    deleteTable,
    cellsOf,
    alignCells,
    anchorCells,
    formatCells,
    tableOp,
    mergeCells,
    canMerge,
    splitCells,
    canSplit,
    fillCells,
    borderCells,
    distributeRows,
    distributeColumns,
    setTableStyle,
    setBorderPen,
    cellSize,
    setCellSize,
    resizeGrid,
    deleteSelection: () => editor.deleteSelected(),
    duplicateSelection: () => editor.duplicateSelected(),
    format,
    paragraphStyle,
    textActive,
    toggle,
    setFont,
    setFontSize,
    stepSize,
    setTextColor,
    setHighlight,
    toggleBaseline,
    clearFormatting,
    setLink,
    align,
    setBullets,
    toggleBullets,
    toggleNumbering,
    indent,
    lineSpacing,
    spacing,
    body,
    targets,
    setFill,
    fillColor,
    setLine,
    setGeometry,
    arrange,
    alignShapes,
    rotate,
    resize,
    move,
    setRotation,
    styleShapes,
    selectAll,
    group,
    ungroup,
    setLayout,
    setTransition,
    setAltText,
    setThemeColors,
    setThemeFonts,
    insertTextBox,
    insertShape,
    insertImage,
    insertTable,
    replaceImage,
    formatChart,
    setChartType,
    setChartData,
    insertChart,
    goToSlideId,
    addSlide,
    duplicateSlide,
    deleteSlides,
    toggleHidden,
    moveSlide,
    setBackground,
    applyBackgroundToAll,
    paragraphs,
    apply,
  };
}

export type EditorCommands = ReturnType<typeof createEditorCommands>;
