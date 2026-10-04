/**
 * Everything the editor can do, as named commands shared by the ribbon,
 * context menus, and keyboard shortcuts. Each command reads the current
 * selection (shapes, text, or table cells) and turns intent into engine
 * operations.
 */

import type {
  AnimationClass,
  AnimationSpec,
  BorderEdges,
  BulletSpec,
  CellRef,
  ChartGrouping,
  ChartSeriesData,
  CropOutline,
  EditableChartKind,
  EditOp,
  FillSpec,
  LinePatch,
  NewShape,
  ParaPatch,
  RunPatch,
  ShapeOutline,
  SlideOutline,
  TextPos,
  TransitionPatch,
} from '@core/pptx-engine/types';
import type { PptxEditorContext } from '../context/pptx-editor-context';
import { effectInfo, specOf } from '../core/animation-catalog';
import { orderRange, textInRange } from '../core/caret';
import { formatState, stepFontSize } from '../core/formatting';
import { linkSpan } from '../core/links';
import { mediaBox, mediaType } from '../core/media';
import { modulate } from '../core/palette';
import { aspectCrop, NO_CROP } from '../core/picture';
import {
  type AlignMode,
  alignOps,
  reorderOps,
  rotateOps,
  sizeOps,
} from '../core/selection';
import { moveSlidesOps } from '../core/slide-selection';
import {
  formatCommand,
  isCollapsed,
  paragraphCommand,
} from '../core/text-commands';
import { createDeckCommands } from './create-deck-commands';
import type { PresentationSession } from './create-presentation-session';
import type { SlideEditor } from './create-slide-editor';
import { audioPoster, videoPoster } from './media-poster';

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
  /** Ids of the slides selected in the rail or sorter (slide commands act on all). */
  slideSelection?: () => number[];
  /** Whether other people edit the presentation live (media must stay small). */
  collaborative?: () => boolean;
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

/** What the link dialog edits (`linkTarget`). */
export interface LinkTarget {
  kind: 'text' | 'cells' | 'shapes';
  /** The text range, for `text`. */
  start?: TextPos;
  end?: TextPos;
  /** The shapes, for `shapes`. */
  shapes?: number[];
  /** The current link and ScreenTip. */
  link?: string;
  tip?: string;
  /** The linked (or selected) text. */
  text?: string;
  /** Whether "Text to display" can replace the text. */
  canSetText: boolean;
}

export function createEditorCommands(options: EditorCommandsOptions) {
  const { session, editor, context } = options;
  const slide = () => session.currentSlide();
  const canEdit = () => context.canEdit();
  /** The selected slides in deck order, or the current one. */
  const selectedSlides = (): SlideOutline[] => {
    const ids = options.slideSelection?.() ?? [];
    const list = session.outline()?.slides.filter((s) => ids.includes(s.id));
    const current = slide();
    return list && list.length > 0 ? list : current ? [current] : [];
  };

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
  const setCharSpacing = (spacing: number) =>
    runs({ spacing: Math.max(-100, Math.min(400, spacing)) });

  // ---- links -----------------------------------------------------------------

  /**
   * What Insert Link edits: the edited text's selection (or the whole link
   * around the caret), the selected cells, or the selected shapes themselves.
   */
  const linkTarget = (): LinkTarget | undefined => {
    const edit = editor.editing();
    if (edit?.layout) {
      const { layout, selection } = edit;
      const span = isCollapsed(selection)
        ? linkSpan(layout, selection.focus)
        : undefined;
      const [start, end] = span
        ? [span.start, span.end]
        : orderRange(selection.anchor, selection.focus);
      const style = layout.styles[start.paragraph];
      const run = style?.runs.find(
        (r) => r.link && r.end > start.offset && r.start <= start.offset
      );
      return {
        kind: 'text',
        start,
        end,
        link: span?.link ?? run?.link,
        tip: span?.tip ?? run?.linkTip,
        text: textInRange(layout, start, end),
        canSetText: start.paragraph === end.paragraph,
      };
    }
    if (cellRange()) return { kind: 'cells', canSetText: false };
    const shapes = editor.selection();
    if (shapes.length === 0) return undefined;
    return {
      kind: 'shapes',
      shapes: shapes.map((x) => x.id),
      link: shapes[0].link,
      tip: shapes[0].linkTip,
      canSetText: false,
    };
  };

  /** Links (or with `link` `""` unlinks) what `linkTarget` names. */
  const applyLink = async (
    target: LinkTarget,
    link: string,
    tip?: string,
    text?: string
  ) => {
    const s = slide();
    if (!s) return;
    const linkTip = link ? (tip ?? '') : undefined;
    if (target.kind === 'text' && target.start && target.end) {
      await editor.linkText(target.start, target.end, link, tip, text);
      options.refocus();
    } else if (target.kind === 'cells') {
      await formatCells({ link, linkTip });
    } else if (target.kind === 'shapes' && target.shapes)
      await apply([
        {
          op: 'setShapeLink',
          slide: s.id,
          shapes: target.shapes,
          link,
          tip: linkTip,
        },
      ]);
  };

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
  /** Moves one shape `steps` places toward the front (negative: back). */
  const moveInZOrder = (shape: number, steps: number) => {
    const s = slide();
    if (!s || steps === 0) return;
    const to = steps > 0 ? 'forward' : 'backward';
    return apply(
      Array.from({ length: Math.abs(steps) }, () => ({
        op: 'reorderShape' as const,
        slide: s.id,
        shape,
        to,
      }))
    );
  };
  const renameShape = (shape: number, name: string) => {
    const s = slide();
    if (s) return apply([{ op: 'setShapeName', slide: s.id, shape, name }]);
  };
  const setShapesHidden = (shapes: number[], hidden: boolean) => {
    const s = slide();
    if (s)
      return apply(
        shapes.map((shape) => ({
          op: 'setShapeHidden' as const,
          slide: s.id,
          shape,
          hidden,
        }))
      );
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
  /** Insert ▸ Video or Audio: embeds the clip with a poster, centered. */
  const insertMedia = async (file: File, kind: 'video' | 'audio') => {
    const checked = mediaType(file, kind, options.collaborative?.() ?? false);
    if ('error' in checked) {
      context.notifyError(checked.error);
      return;
    }
    try {
      const poster =
        kind === 'video' ? await videoPoster(file) : await audioPoster();
      const natural =
        kind === 'video'
          ? { w: poster.width * 0.75, h: poster.height * 0.75 }
          : { w: 48, h: 48 };
      const box = mediaBox(natural, options.slideSize());
      const id = await insert(
        {
          kind,
          data: await fileToBase64(file),
          contentType: checked.type,
          poster: poster.data,
          description: file.name,
        },
        box
      );
      if (id !== undefined) editor.select(id);
      options.refocus();
    } catch {
      context.notifyError(`That ${kind} could not be inserted.`);
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
  /** Duplicates a slide, or every selected slide when it is one of them. */
  const duplicateSlide = async (id?: number) => {
    const selected = selectedSlides();
    const ids =
      id === undefined || selected.some((s) => s.id === id)
        ? selected.map((s) => s.id)
        : [id];
    const result = await apply(
      ids.map((slide) => ({ op: 'duplicateSlide' as const, slide }))
    );
    const created = result?.created.at(-1)?.slide;
    if (created !== undefined) goToSlideId(created);
  };
  const deleteSlides = async (ids: number[]) => {
    const deck = session.outline();
    if (!deck || ids.length === 0 || ids.length >= deck.slides.length) return;
    editor.goToSlide(session.slideIndex());
    await apply(ids.map((slide) => ({ op: 'deleteSlide' as const, slide })));
  };
  /** Hides or shows a slide, and the rest of the selection with it. */
  const toggleHidden = (s: SlideOutline) => {
    const selected = selectedSlides();
    const all = selected.some((x) => x.id === s.id) ? selected : [s];
    return apply(
      all.map((x) => ({
        op: 'setSlideHidden' as const,
        slide: x.id,
        hidden: !s.hidden,
      }))
    );
  };
  const moveSlide = async (id: number, to: number) => {
    await apply([{ op: 'moveSlide', slide: id, to }]);
    goToSlideId(id);
  };
  /** Moves slides as a block before the slide now at `at`. */
  const moveSlides = async (ids: number[], at: number) => {
    const deck = session.outline();
    const current = slide()?.id;
    if (!deck) return;
    await apply(
      moveSlidesOps(
        deck.slides.map((s) => s.id),
        ids,
        at
      )
    );
    if (current !== undefined) goToSlideId(current);
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
    const ids = all
      ? deck.slides.map((x) => x.id)
      : selectedSlides().map((x) => x.id);
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
  /** Changes the layout of the selected slides. */
  const setLayout = async (layout: string) => {
    await apply(
      selectedSlides().map((s) => ({
        op: 'setSlideLayout' as const,
        slide: s.id,
        layout,
      }))
    );
  };
  /** Changes the transition of the selected slides (or, with `applyToAll`, every slide). */
  const setTransition = (patch: Omit<TransitionPatch, 'slide'>) =>
    apply(
      (patch.applyToAll ? selectedSlides().slice(0, 1) : selectedSlides()).map(
        (s) => ({
          op: 'setTransition' as const,
          slide: s.id,
          ...patch,
        })
      )
    );
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

  // ---- animations ------------------------------------------------------------

  const animations = () => slide()?.animations ?? [];
  const writeAnimations = (list: AnimationSpec[]) => {
    const s = slide();
    if (!s) return Promise.resolve(null);
    return apply([{ op: 'setAnimations', slide: s.id, animations: list }]);
  };
  // Animation edits rewrite the slide's whole list, so each one waits for
  // the last to land and reads the list afresh.
  let animationQueue: Promise<unknown> = Promise.resolve();
  const serial =
    <A extends unknown[], T>(edit: (...args: A) => Promise<T>) =>
    (...args: A): Promise<T> => {
      const next = animationQueue.then(
        () => edit(...args),
        () => edit(...args)
      );
      animationQueue = next.catch(() => {});
      return next;
    };
  /**
   * Gives the selected shapes an effect, as the Animation gallery does:
   * `replace` swaps the effect of their animations (or of the one picked
   * in the pane), `add` adds one more (Add Animation), and the effect
   * `none` removes their animations.
   */
  const animate = serial(
    (
      cls: AnimationClass,
      effect: string,
      mode: 'replace' | 'add',
      picked?: number
    ) => {
      const ids = new Set(targets().map((t) => t.id));
      if (ids.size === 0) return Promise.resolve(null);
      const list = animations().map(specOf);
      const holds = (a: AnimationSpec) => ids.has(a.shapeId);
      if (effect === 'none')
        return writeAnimations(list.filter((a) => !holds(a)));
      const option = effectInfo(cls, effect)?.options?.[0]?.value;
      const swap = (a: AnimationSpec): AnimationSpec => ({
        shapeId: a.shapeId,
        class: cls,
        effect,
        start: a.start,
        delayMs: a.delayMs,
        direction: option,
        paragraph: a.paragraph,
      });
      const fresh = (shapeId: number): AnimationSpec => ({
        shapeId,
        class: cls,
        effect,
        start: 'onClick',
        direction: option,
      });
      if (mode === 'add')
        return writeAnimations([...list, ...[...ids].map(fresh)]);
      if (picked !== undefined && list[picked] && holds(list[picked]))
        return writeAnimations(
          list.map((a, i) => (i === picked ? swap(a) : a))
        );
      const missing = [...ids].filter(
        (id) => !list.some((a) => a.shapeId === id)
      );
      return writeAnimations([
        ...list.map((a) => (holds(a) ? swap(a) : a)),
        ...missing.map(fresh),
      ]);
    }
  );
  /** Changes animations' timing or options. */
  const updateAnimations = serial(
    (indexes: number[], patch: Partial<AnimationSpec>) =>
      writeAnimations(
        animations().map((a, i) =>
          indexes.includes(i) ? { ...specOf(a), ...patch } : specOf(a)
        )
      )
  );
  /** Moves an animation earlier (-1) or later (1) in the sequence. */
  const moveAnimation = serial((index: number, delta: -1 | 1) => {
    const list = animations().map(specOf);
    const to = index + delta;
    if (!list[index] || to < 0 || to >= list.length)
      return Promise.resolve(null);
    const [moved] = list.splice(index, 1);
    list.splice(to, 0, moved);
    return writeAnimations(list);
  });
  const removeAnimations = serial((indexes: number[]) =>
    writeAnimations(
      animations()
        .map(specOf)
        .filter((_, i) => !indexes.includes(i))
    )
  );
  /**
   * Effect Options ▸ Sequence: a text shape animates as one object, or
   * paragraph by paragraph (one click each).
   */
  const setSequence = serial((shape: ShapeOutline, byParagraph: boolean) => {
    const list = animations().map(specOf);
    const own = list.filter((a) => a.shapeId === shape.id);
    const first = own[0];
    if (!first) return Promise.resolve(null);
    const at = list.indexOf(first);
    const rest = list.filter((a) => a.shapeId !== shape.id);
    const paragraphs = (shape.paragraphs ?? [])
      .map((p, i) => ({ i, text: p.text }))
      .filter((p) => p.text.trim() !== '')
      .map((p) => p.i);
    const replaced: AnimationSpec[] =
      byParagraph && paragraphs.length > 0
        ? paragraphs.map((paragraph, n) => ({
            ...first,
            paragraph,
            start: n === 0 ? first.start : 'onClick',
          }))
        : [{ ...first, paragraph: undefined }];
    const before = rest.slice(
      0,
      list.slice(0, at).filter((a) => a.shapeId !== shape.id).length
    );
    const after = rest.slice(before.length);
    return writeAnimations([...before, ...replaced, ...after]);
  });
  // ---- pictures and effects (Picture Format, Shape and Text Effects) --------

  /** The selected pictures, which picture commands act on. */
  const pictures = () => targets().filter((s) => s.kind === 'picture');
  /** Corrections, recolor, transparency, or a reset of every selected picture. */
  const formatPicture = (change: PictureChange, group?: string) => {
    const s = slide();
    const list = pictures();
    if (!s || list.length === 0) return Promise.resolve(null);
    return apply(
      [
        {
          op: 'formatPicture',
          slide: s.id,
          shapes: list.map((p) => p.id),
          ...change,
        },
      ],
      group
    );
  };
  /** Crops each selected picture to edges (fractions of its image). */
  const cropPictures = (
    edges: (picture: ShapeOutline) => Partial<CropOutline>,
    group?: string
  ) => {
    const s = slide();
    if (!s) return Promise.resolve(null);
    return apply(
      pictures().map((p) => ({
        op: 'cropPicture' as const,
        slide: s.id,
        shape: p.id,
        ...edges(p),
      })),
      group
    );
  };
  /** Crops each selected picture to the largest centered `ratio` (w/h) part. */
  const cropToAspect = (ratio: number) =>
    cropPictures((p) =>
      aspectCrop(p.w, p.h, p.picture?.crop ?? NO_CROP, ratio)
    );
  /** Fills or fits each selected picture to its frame (Crop ▸ Fill / Fit). */
  const fitPictures = (mode: 'fill' | 'fit') => {
    const s = slide();
    if (!s) return Promise.resolve(null);
    return apply(
      pictures().map((p) => ({
        op: 'cropPicture' as const,
        slide: s.id,
        shape: p.id,
        mode,
      }))
    );
  };
  /**
   * Removes the pictures' adjustments and effects (Reset Picture); with
   * `size`, their crop too, the frame growing back (Reset Picture & Size).
   */
  const resetPictures = (size: boolean) => {
    const s = slide();
    const ids = pictures().map((p) => p.id);
    if (!s || ids.length === 0) return Promise.resolve(null);
    return apply([
      size
        ? { op: 'formatPicture', slide: s.id, shapes: ids, reset: true }
        : {
            op: 'formatPicture',
            slide: s.id,
            shapes: ids,
            brightness: 0,
            contrast: 0,
            recolor: 'none',
            transparency: 0,
          },
      {
        op: 'setShapeEffects',
        slide: s.id,
        shapes: ids,
        shadow: 'none',
        glow: 'none',
        softEdge: 'none',
        reflection: 'none',
      },
    ]);
  };
  /** Shadow, glow, soft edges, or reflection of every selected shape, as one step. */
  const setShapeEffects = (change: EffectsChange, group?: string) => {
    const s = slide();
    const list = targets();
    if (!s || list.length === 0) return Promise.resolve(null);
    return apply(
      [
        {
          op: 'setShapeEffects',
          slide: s.id,
          shapes: list.map((x) => x.id),
          ...change,
        },
      ],
      group
    );
  };
  /** Text shadow and glow of the selected text (whole shapes when none is). */
  const setTextEffects = (change: Pick<RunPatch, 'shadow' | 'glow'>) =>
    runs(change);
  const pictureCommands = {
    pictures,
    formatPicture,
    cropPictures,
    cropToAspect,
    fitPictures,
    resetPictures,
    setShapeEffects,
    setTextEffects,
  };
  // ---- end pictures and effects -----------------------------------------------

  return {
    canEdit,
    animate,
    updateAnimations,
    moveAnimation,
    removeAnimations,
    setSequence,
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
    setCharSpacing,
    linkTarget,
    applyLink,
    moveInZOrder,
    renameShape,
    setShapesHidden,
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
    insertMedia,
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
    moveSlides,
    setBackground,
    applyBackgroundToAll,
    paragraphs,
    apply,
    // ---- deck setup: header & footer, slide size, sections ----
    ...createDeckCommands({ apply, outline: session.outline }),
    ...pictureCommands,
  };
}

export type EditorCommands = ReturnType<typeof createEditorCommands>;

/** The fields of a `formatPicture` op a command sets. */
export type PictureChange = Omit<
  Extract<EditOp, { op: 'formatPicture' }>,
  'op' | 'slide' | 'shapes'
>;
/** The fields of a `setShapeEffects` op a command sets. */
export type EffectsChange = Omit<
  Extract<EditOp, { op: 'setShapeEffects' }>,
  'op' | 'slide' | 'shapes'
>;
