/**
 * The presentation editor: ribbon, slide rail, the slide stage with
 * selection, in-place text and table editing, right-click menus, the format
 * pane, speaker notes, find and replace, and the slide show.
 */

import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import type {
  CellRef,
  ShapeOutline,
  SlideOutline,
} from '@core/pptx-engine/types';
import { ContextMenu } from '@kobalte/core/context-menu';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import ClipboardIcon from '@phosphor/clipboard.svg';
import CloudCheck from '@phosphor/cloud-check.svg';
import CopyIcon from '@phosphor/copy.svg';
import CopySimple from '@phosphor/copy-simple.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import Play from '@phosphor/play.svg';
import Plus from '@phosphor/plus.svg';
import Printer from '@phosphor/printer.svg';
import Rectangle from '@phosphor/rectangle.svg';
import Scissors from '@phosphor/scissors.svg';
import SquaresFour from '@phosphor/squares-four.svg';
import Trash from '@phosphor/trash.svg';
import WarningIcon from '@phosphor/warning.svg';
import { Button } from '@ui/components/Button';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  AnimationPane,
  AnimationPreview,
  AnimationTags,
} from '../components/animation-pane';
import {
  ChartDataEditor,
  ChartDesignTab,
  ChartGallery,
  sampleChartData,
} from '../components/chart-controls';
import { CropOverlay } from '../components/crop-overlay';
import { DeckSetupDialogs } from '../components/deck-setup-dialogs';
import { FindReplace } from '../components/find-replace';
import { FormatPane, type PaneSection } from '../components/format-pane';
import { LinkDialog } from '../components/link-dialog';
import { MediaPlayButton, MediaPlayer } from '../components/media-player';
import { NotesPanel } from '../components/notes-panel';
import { Collaborators, PeerSelections } from '../components/peer-presence';
import { PresenterView } from '../components/presenter-view';
import { PrintDialog } from '../components/print-dialog';
import { AnimationsTab } from '../components/ribbon/animations-tab';
import { RibbonButton } from '../components/ribbon/controls';
import { HomeTab } from '../components/ribbon/home-tab';
import { InsertTab } from '../components/ribbon/insert-tab';
import {
  DesignTab,
  ShapeFormatTab,
  SlideShowTab,
  TransitionsTab,
  ViewTab,
} from '../components/ribbon/other-tabs';
import { PictureFormatTab } from '../components/ribbon/picture-format-tab';
import {
  Ribbon,
  type RibbonEnv,
  type RibbonTab,
} from '../components/ribbon/ribbon';
import {
  TableDesignTab,
  TableLayoutTab,
} from '../components/ribbon/table-tabs';
import { Gridlines, Rulers } from '../components/rulers';
import { SectionHeaders, SectionMenuItems } from '../components/section-header';
import { SelectionOverlay } from '../components/selection-overlay';
import { SelectionPane } from '../components/selection-pane';
import { SlideRail } from '../components/slide-rail';
import { SlideStage } from '../components/slide-stage';
import { SlideShow } from '../components/slideshow';
import {
  type MenuTarget,
  StageMenuItems,
} from '../components/stage-context-menu';
import { usePptxEditorContext } from '../context/pptx-editor-context';
import { caretSegment, positionAt, selectionQuads } from '../core/caret';
import { type Box, boxOf, hitTest, type Point } from '../core/geometry';
import { linkAction, linkAt } from '../core/links';
import { STANDARD_SWATCHES, themeGrid, themeSwatches } from '../core/palette';
import { unionBounds } from '../core/selection';
import { clickSlide, type SlideSelection } from '../core/slide-selection';
import {
  anchorOf,
  boundaryAt,
  cellAt,
  cellBox,
  nextCell,
  rangeBox,
  tableGeometry,
} from '../core/table';
import { paragraphCommand } from '../core/text-commands';
import { createClipboard } from '../primitives/create-clipboard';
import { createCropMode } from '../primitives/create-crop-mode';
import { createDeckSetup } from '../primitives/create-deck-setup';
import {
  createEditorCommands,
  type LinkTarget,
} from '../primitives/create-editor-commands';
import { createFormatPainter } from '../primitives/create-format-painter';
import { createMediaUrls } from '../primitives/create-media-urls';
import { createPictureImages } from '../primitives/create-picture-images';
import { createPresentationSession } from '../primitives/create-presentation-session';
import { createRenderQueue } from '../primitives/create-render-queue';
import { createSlideEditor } from '../primitives/create-slide-editor';
import { createThumbnails } from '../primitives/create-thumbnails';
import { createViewOptions } from '../primitives/create-view-options';

const STAGE_MARGIN = 32;

/** Pixel widths are rounded up so small resizes reuse renders. */
const quantize = (px: number) =>
  Math.min(4096, Math.max(256, Math.ceil(px / 64) * 64));

/** CSS pixels per point at 100% zoom (96 dpi). */
const PX_PER_PT = 96 / 72;

/** A cell being edited in a plain text field (when the engine can't lay it out). */
interface CellEdit {
  shape: ShapeOutline;
  row: number;
  col: number;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
}

/** A cell range selected in a table. */
interface TableRange {
  shape: number;
  from: CellRef;
  to: CellRef;
}

/** A pointer gesture inside a table. */
type TableGesture =
  | { kind: 'cells'; shape: number; from: CellRef; at: Point; moved: boolean }
  | {
      kind: 'border';
      shape: number;
      axis: 'col' | 'row';
      index: number;
      start: Point;
      current: Point;
    };

/** The format painter's pointer: an arrow with a brush, hot spot at the tip. */
const PAINT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M2 2v15l4-4 3 6 2-1-3-6h5z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/><g transform="translate(12 10) scale(0.06)"><path d="M232,32a8,8,0,0,0-8-8c-44.08,0-89.31,49.71-114.43,82.63A60,60,0,0,0,32,164c0,30.88-19.54,44.73-20.47,45.37A8,8,0,0,0,16,224H92a60,60,0,0,0,57.37-77.57C182.3,121.31,232,76.08,232,32Z" fill="#fff" stroke="#000" stroke-width="18"/></g></svg>'
)}") 2 2, copy`;

export function PptxEditor() {
  const context = usePptxEditorContext();
  const { engine } = context;
  const readonly = () => !context.canEdit();

  const session = createPresentationSession({
    engine,
    persist: context.persist,
    canEdit: context.canEdit,
    notifyError: context.notifyError,
    notifyInfo: context.notifyInfo,
    watchStoredFile: context.watchStoredFile,
    fetchLatest: context.fetchLatest,
    autosaveDelay: context.autosaveDelay,
  });
  const [loadError, setLoadError] = createSignal<string>();
  void session.refresh().catch((e: unknown) => {
    setLoadError(e instanceof Error ? e.message : String(e));
  });

  const queue = createRenderQueue();
  const dpr = () =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  // ---- stage geometry and zoom ---------------------------------------------

  let stageHost!: HTMLDivElement;
  const [hostSize, setHostSize] = createSignal({ w: 0, h: 0 });
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setHostSize({ w: r.width, h: r.height });
    });
    observer.observe(stageHost);
    onCleanup(() => observer.disconnect());
  });

  const slideW = () => session.outline()?.width ?? 960;
  const slideH = () => session.outline()?.height ?? 540;
  const [zoom, setZoomRaw] = createSignal<number | 'fit'>('fit');
  const fitScale = () => {
    const { w, h } = hostSize();
    if (w <= 0 || h <= 0) return 0;
    return Math.max(
      0.05,
      Math.min(
        (w - 2 * STAGE_MARGIN) / slideW(),
        (h - 2 * STAGE_MARGIN) / slideH()
      )
    );
  };
  /** CSS pixels per point. */
  const scale = () => {
    const z = zoom();
    if (hostSize().w <= 0) return 0;
    return z === 'fit' ? fitScale() : z * PX_PER_PT;
  };
  const setZoom = (z: number | 'fit') =>
    setZoomRaw(z === 'fit' ? 'fit' : Math.min(4, Math.max(0.1, z)));
  const zoomBy = (factor: number) => {
    const current = scale() / PX_PER_PT || 1;
    setZoom(current * factor);
  };
  const renderWidth = createMemo(() =>
    scale() > 0 ? quantize(slideW() * scale() * dpr()) : 0
  );
  const unit = () => 1 / Math.max(scale(), 0.01);

  const view = createViewOptions();
  const editor = createSlideEditor({
    engine,
    session,
    queue,
    canEdit: context.canEdit,
    renderWidth,
    pointsPerPixel: unit,
    snap: () => ({
      guides: view.options().guides,
      grid: view.options().snapToGrid ? view.options().gridSpacing : undefined,
    }),
  });

  // ---- tables ----------------------------------------------------------------

  const [tableRange, setTableRange] = createSignal<TableRange | null>(null);
  let tableGesture: TableGesture | null = null;
  const [borderGuide, setBorderGuide] = createSignal<TableGesture | null>(null);
  /** The table the selection is in (one selected table shape). */
  const selectedTable = () => {
    const edit = editor.editing();
    const shape = edit ? editor.findShape(edit.shape) : editor.selectedShape();
    return shape?.kind === 'table' && shape.table ? shape : undefined;
  };
  /** The cells table commands act on: a range, the edited cell, or all. */
  const tableTarget = () => {
    const shape = selectedTable();
    if (!shape) return undefined;
    const range = tableRange();
    if (range && range.shape === shape.id)
      return { shape, from: range.from, to: range.to };
    const cell = editor.editing()?.cell;
    if (cell) return { shape, from: cell, to: cell };
    const rows = shape.table?.rowHeights.length ?? 1;
    const cols = shape.table?.columnWidths.length ?? 1;
    return {
      shape,
      from: { row: 0, col: 0 },
      to: { row: rows - 1, col: cols - 1 },
    };
  };
  const selectWholeRows = () => {
    const t = tableTarget();
    if (!t) return;
    const cols = t.shape.table?.columnWidths.length ?? 1;
    editor.stopEditing();
    setTableRange({
      shape: t.shape.id,
      from: { row: Math.min(t.from.row, t.to.row), col: 0 },
      to: { row: Math.max(t.from.row, t.to.row), col: cols - 1 },
    });
  };
  const selectWholeColumns = () => {
    const t = tableTarget();
    if (!t) return;
    const rows = t.shape.table?.rowHeights.length ?? 1;
    editor.stopEditing();
    setTableRange({
      shape: t.shape.id,
      from: { row: 0, col: Math.min(t.from.col, t.to.col) },
      to: { row: rows - 1, col: Math.max(t.from.col, t.to.col) },
    });
  };
  const selectWholeTable = () => {
    const shape = selectedTable();
    if (!shape) return;
    editor.stopEditing();
    setTableRange({
      shape: shape.id,
      from: { row: 0, col: 0 },
      to: {
        row: (shape.table?.rowHeights.length ?? 1) - 1,
        col: (shape.table?.columnWidths.length ?? 1) - 1,
      },
    });
  };

  // ---- presence (collaborative presentations) -----------------------------

  const collaboration = context.collaboration;
  /** Where this person is, as a stable key (keystrokes do not change it). */
  const whereabouts = createMemo(() => {
    const slide = session.currentSlide();
    const ids = editor.selectedIds();
    return slide
      ? `${slide.id}:${ids.join(',')}:${editor.editing() ? 1 : 0}`
      : '';
  });
  // Sharing it with the presence channel syncs an external system.
  createEffect(
    on(whereabouts, (key) => {
      if (!collaboration) return;
      const [slide, shapes, editing] = key.split(':');
      collaboration.setSelection(
        key
          ? {
              slide: Number(slide),
              shapes: shapes ? shapes.split(',').map(Number) : [],
              editing: editing === '1',
            }
          : undefined
      );
    })
  );
  onCleanup(() => collaboration?.setSelection(undefined));
  const peersOn = (slideId: number) =>
    collaboration?.peers().filter((p) => p.selection.slide === slideId) ?? [];

  /** CSS width thumbnails are drawn at: wider in the slide sorter. */
  const thumbnailWidth = () => (sorter() ? 280 : 150);
  const thumbnails = createThumbnails({
    engine,
    session,
    queue,
    width: () => Math.round(thumbnailWidth() * dpr()),
  });

  // ---- focus ---------------------------------------------------------------

  let input!: HTMLTextAreaElement;
  let stage!: HTMLDivElement;
  const focusInput = () => input?.focus({ preventScroll: true });
  const focusStage = () => stage?.focus({ preventScroll: true });
  const refocus = () => (editor.editing() ? focusInput() : focusStage());

  const startEditing = async (shape: number, at?: Point) => {
    setTableRange(null);
    await editor.startEditing(shape, at);
    focusInput();
  };
  const stopEditing = () => {
    editor.stopEditing();
    focusStage();
  };

  const toSlide = (e: { clientX: number; clientY: number }): Point => {
    const rect = stage.getBoundingClientRect();
    const s = scale() || 1;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
  };

  // ---- slide selection (rail and sorter) -------------------------------------

  const [slideSelection, setSlideSelection] = createSignal<SlideSelection>({
    ids: [],
    anchor: -1,
  });
  /** Selected slide ids in deck order; the current slide alone by default. */
  const selectedSlideIds = createMemo(() => {
    const current = session.currentSlide();
    if (!current) return [];
    const ids = new Set(slideSelection().ids);
    const list = (session.outline()?.slides ?? [])
      .map((s) => s.id)
      .filter((id) => ids.has(id));
    return list.includes(current.id) ? list : [current.id];
  });
  const selectSlide = (
    index: number,
    mods: { shift: boolean; toggle: boolean }
  ) => {
    const slides = session.outline()?.slides ?? [];
    const id = slides[index]?.id;
    const current = session.currentSlide()?.id;
    if (id === undefined || current === undefined) return;
    const ids = selectedSlideIds();
    const anchor = ids.includes(slideSelection().anchor)
      ? slideSelection().anchor
      : current;
    const next = clickSlide(
      slides.map((s) => s.id),
      { ids, anchor },
      id,
      mods
    );
    setSlideSelection(next);
    const focus = next.ids.includes(id) ? id : next.ids[next.ids.length - 1];
    const at = slides.findIndex((s) => s.id === focus);
    if (at >= 0) editor.goToSlide(at);
  };
  const selectAllSlides = () => {
    const slides = session.outline()?.slides ?? [];
    setSlideSelection({
      ids: slides.map((s) => s.id),
      anchor: session.currentSlide()?.id ?? -1,
    });
  };
  /** Selects these slides (a section's); the first becomes current. */
  const selectSlides = (ids: number[]) => {
    const slides = session.outline()?.slides ?? [];
    const first = slides.findIndex((s) => ids.includes(s.id));
    if (first < 0) return;
    setSlideSelection({ ids, anchor: slides[first].id });
    editor.goToSlide(first);
  };

  // ---- commands -------------------------------------------------------------

  const commands = createEditorCommands({
    session,
    editor,
    context,
    slideSize: () => ({ w: slideW(), h: slideH() }),
    refocus,
    startEditing: (id) => void startEditing(id),
    tableTarget,
    slideSelection: selectedSlideIds,
  });

  const deckSetup = createDeckSetup({
    session,
    commands,
    canEdit: context.canEdit,
    selectedSlideIds,
    selectSlides,
  });

  const [railFocused, setRailFocused] = createSignal(false);
  const clipboard = createClipboard({
    engine,
    session,
    editor,
    commands,
    notifyError: context.notifyError,
    railSelection: () => (railFocused() ? selectedSlideIds() : undefined),
  });

  const painter = createFormatPainter({ engine, session, editor });

  // Picture Format: the pictures' original images and crop mode.
  const pictureImages = createPictureImages({ engine, session });
  const crop = createCropMode({
    engine,
    session,
    editor,
    queue,
    canEdit: context.canEdit,
    renderWidth,
    onExit: () => queueMicrotask(focusStage),
  });

  // ---- table cell editing ---------------------------------------------------

  const [cellEdit, setCellEdit] = createSignal<CellEdit | null>(null);
  const commitCell = async (value: string) => {
    const edit = cellEdit();
    const slide = session.currentSlide();
    setCellEdit(null);
    if (!edit || !slide || value === edit.text) return;
    await session.apply([
      {
        op: 'setCellText',
        slide: slide.id,
        shape: edit.shape.id,
        row: edit.row,
        col: edit.col,
        text: value,
      },
    ]);
  };

  /** Puts the caret in a cell (in place when the engine lays cells out). */
  const editCell = async (shape: ShapeOutline, ref: CellRef, at?: Point) => {
    const g = tableGeometry(shape);
    if (!g || readonly()) return;
    const anchor = anchorOf(shape, ref);
    const bounds = cellBox(shape, g, anchor);
    setTableRange(null);
    await editor.startEditing(shape.id, at, { ref: anchor, bounds });
    if (editor.editing()?.layout) {
      focusInput();
      return;
    }
    // No cell layout from the engine: edit the cell's text in a field.
    editor.stopEditing();
    editor.select(shape.id);
    setCellEdit({
      shape,
      row: anchor.row,
      col: anchor.col,
      text: shape.table?.rows[anchor.row]?.[anchor.col] ?? '',
      rect: bounds,
    });
  };

  /** Tab/Shift+Tab between cells; Tab past the last cell adds a row. */
  const tabCell = async (direction: 1 | -1) => {
    const edit = editor.editing();
    const shape = edit && editor.findShape(edit.shape);
    if (!edit?.cell || !shape) return;
    const next = nextCell(shape, edit.cell, direction);
    if (next) {
      await editCell(shape, next);
      editor.selectAllText();
      return;
    }
    if (direction < 0) return;
    const slide = session.currentSlide();
    if (!slide) return;
    const rows = shape.table?.rowHeights.length ?? 0;
    editor.stopEditing();
    await session.apply([
      { op: 'insertTableRow', slide: slide.id, shape: shape.id, at: rows },
    ]);
    const updated = editor.findShape(shape.id);
    if (updated) await editCell(updated, { row: rows, col: 0 });
  };

  /** The table (and cell) under a point, when a click should go to its cells. */
  const tableHit = (at: Point) => {
    const slide = session.currentSlide();
    const hit = slide ? hitTest(slide.shapes, at) : undefined;
    if (hit?.kind !== 'table' || !hit.table || hit.rotation) return undefined;
    const g = tableGeometry(hit);
    if (!g) return undefined;
    // The frame's edge moves the table; inside, clicks go to cells.
    const edge = 4 * unit();
    const nearEdge =
      at.x - g.xs[0] < edge ||
      g.xs[g.xs.length - 1] - at.x < edge ||
      at.y - g.ys[0] < edge ||
      g.ys[g.ys.length - 1] - at.y < edge;
    const cell = cellAt(g, at);
    if (!cell || nearEdge) return undefined;
    return { shape: hit, g, cell };
  };

  // ---- pointer ---------------------------------------------------------------

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (cellEdit())
      void commitCell(
        (document.getElementById('pptx-cell-input') as HTMLTextAreaElement)
          ?.value ?? ''
      );
    const at = toSlide(e);
    if (painter.active() && paintAt(at)) {
      e.preventDefault();
      return;
    }
    stage.setPointerCapture(e.pointerId);
    const toggle = e.metaKey || e.ctrlKey;
    // A click on the slide stops a clip playing over it.
    setPlaying(undefined);
    // Ctrl+click follows a link in the text being edited, as in PowerPoint.
    const editLayout = editor.editing()?.layout;
    if (toggle && editLayout) {
      const pos = positionAt(editLayout, at);
      const link = pos && linkAt(editLayout, pos);
      if (link) {
        e.preventDefault();
        followLink(link);
        return;
      }
    }
    const t = !e.shiftKey && !toggle && !readonly() ? tableHit(at) : undefined;
    if (t) {
      const edit = editor.editing();
      const sameCell =
        edit?.shape === t.shape.id &&
        edit.cell &&
        anchorOf(t.shape, edit.cell).row === anchorOf(t.shape, t.cell).row &&
        anchorOf(t.shape, edit.cell).col === anchorOf(t.shape, t.cell).col;
      // A column or row border of the selected table resizes it.
      const border =
        editor.selectedShape()?.id === t.shape.id
          ? boundaryAt(t.g, at, 3 * unit())
          : undefined;
      if (border) {
        tableGesture = {
          kind: 'border',
          shape: t.shape.id,
          axis: border.kind,
          index: border.index,
          start: at,
          current: at,
        };
        setBorderGuide(tableGesture);
        e.preventDefault();
        return;
      }
      if (sameCell) {
        editor.pointerDown(at, { shift: false, detail: e.detail });
        e.preventDefault();
        focusInput();
        tableGesture = {
          kind: 'cells',
          shape: t.shape.id,
          from: t.cell,
          at,
          moved: false,
        };
        return;
      }
      if (edit) editor.stopEditing();
      editor.select(t.shape.id);
      setTableRange(null);
      tableGesture = {
        kind: 'cells',
        shape: t.shape.id,
        from: t.cell,
        at,
        moved: false,
      };
      e.preventDefault();
      focusStage();
      return;
    }
    tableGesture = null;
    setTableRange(null);
    editor.pointerDown(at, { shift: e.shiftKey, toggle, detail: e.detail });
    if (editor.editing()) {
      e.preventDefault();
      focusInput();
    } else {
      focusStage();
    }
  };

  /**
   * A click while the format painter is armed paints the shape under it
   * (text being edited is painted by selecting it instead). True when the
   * click was taken.
   */
  const paintAt = (at: Point): boolean => {
    const slide = session.currentSlide();
    const hit = slide ? hitTest(slide.shapes, at) : undefined;
    const edit = editor.editing();
    if (edit && hit?.id === edit.shape) return false;
    if (!hit) {
      painter.cancel();
      return false;
    }
    if (edit) editor.stopEditing();
    editor.select(hit.id);
    focusStage();
    void painter.paintShapes([hit]);
    return true;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!stage.hasPointerCapture(e.pointerId)) return;
    const at = toSlide(e);
    const g = tableGesture;
    if (g?.kind === 'border') {
      g.current = at;
      setBorderGuide({ ...g });
      return;
    }
    if (g?.kind === 'cells') {
      const shape = editor.findShape(g.shape);
      const geometry = shape && tableGeometry(shape);
      const cell = geometry && cellAt(geometry, at);
      if (!cell) return;
      if (cell.row !== g.from.row || cell.col !== g.from.col || g.moved) {
        if (!g.moved && editor.editing()) editor.stopEditing();
        g.moved = true;
        setTableRange({ shape: g.shape, from: g.from, to: cell });
      } else if (editor.editing()) {
        editor.pointerMove(at, { shift: e.shiftKey });
      }
      return;
    }
    editor.pointerMove(at, { shift: e.shiftKey, alt: e.altKey });
  };

  const onPointerUp = (e: PointerEvent) => {
    if (stage.hasPointerCapture(e.pointerId))
      stage.releasePointerCapture(e.pointerId);
    const g = tableGesture;
    tableGesture = null;
    if (g?.kind === 'border') {
      setBorderGuide(null);
      const delta =
        g.axis === 'col' ? g.current.x - g.start.x : g.current.y - g.start.y;
      if (Math.abs(delta) > 0.5)
        void commands.resizeGrid?.(g.shape, g.axis, g.index, delta);
      return;
    }
    if (g?.kind === 'cells') {
      void editor.pointerUp();
      if (!g.moved && !editor.editing()?.cell) {
        const shape = editor.findShape(g.shape);
        if (shape) void editCell(shape, g.from, g.at);
      }
      return;
    }
    void editor.pointerUp();
    if (painter.active() && editor.editing()) void painter.paintSelection();
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (readonly()) return;
    const at = toSlide(e);
    const slide = session.currentSlide();
    const hit = slide ? hitTest(slide.shapes, at) : undefined;
    if (!hit || editor.editing()) return;
    if (hit.kind === 'table') return;
    if (hit.kind === 'chart') {
      chartEditor(hit);
      return;
    }
    if (hit.textEditable) void startEditing(hit.id, at);
  };

  // ---- right-click -------------------------------------------------------

  const [menuTarget, setMenuTarget] = createSignal<MenuTarget>({
    kind: 'canvas',
  });
  /** Selects what was right-clicked (keeping a selection it is part of). */
  const onContextMenu = (e: MouseEvent) => {
    const at = toSlide(e);
    const edit = editor.editing();
    if (edit) {
      const shape = editor.findShape(edit.shape);
      const box = edit.bounds ?? (shape && boxOf(shape));
      if (
        box &&
        at.x >= box.x &&
        at.x <= box.x + box.w &&
        at.y >= box.y &&
        at.y <= box.y + box.h
      ) {
        setMenuTarget({ kind: edit.cell ? 'table' : 'text' });
        return;
      }
      editor.stopEditing();
    }
    const t = tableHit(at);
    if (t) {
      const range = tableRange();
      const inRange =
        range?.shape === t.shape.id &&
        t.cell.row >= Math.min(range.from.row, range.to.row) &&
        t.cell.row <= Math.max(range.from.row, range.to.row) &&
        t.cell.col >= Math.min(range.from.col, range.to.col) &&
        t.cell.col <= Math.max(range.from.col, range.to.col);
      editor.select(t.shape.id);
      if (!inRange)
        setTableRange({ shape: t.shape.id, from: t.cell, to: t.cell });
      setMenuTarget({ kind: 'table' });
      return;
    }
    const slide = session.currentSlide();
    const hit = slide ? hitTest(slide.shapes, at) : undefined;
    if (!hit) {
      editor.setSelection([]);
      setMenuTarget({ kind: 'canvas' });
      return;
    }
    if (!editor.selectedIds().includes(hit.id)) editor.select(hit.id);
    setTableRange(null);
    setMenuTarget({
      kind:
        hit.kind === 'chart' && editor.selection().length === 1
          ? 'chart'
          : hit.kind === 'table' && editor.selection().length === 1
            ? 'table'
            : 'shapes',
    });
  };

  // ---- keyboard ----------------------------------------------------------

  const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

  const undo = async () => {
    if (editor.editing()) editor.stopEditing();
    await session.undo();
  };
  const redo = async () => {
    if (editor.editing()) editor.stopEditing();
    await session.redo();
  };

  /** Shortcuts shared by the stage and the text being edited. */
  const sharedShortcut = (e: KeyboardEvent): boolean => {
    const key = e.key.toLowerCase();
    const mod = isMod(e);
    if (e.key === 'F5') {
      present(e.shiftKey, e.altKey);
      return true;
    }
    if (e.key === 'F10' && e.altKey) {
      toggleSelectionPane();
      return true;
    }
    if (!mod) return false;
    if (key === 'c' && e.shiftKey) void painter.copy();
    else if (key === 'v' && e.shiftKey && !readonly())
      void painter.pasteToSelection();
    else if (key === 'z') void (e.shiftKey ? redo() : undo());
    else if (key === 'y') void redo();
    else if (key === 's') void session.save().catch(() => {});
    else if (key === 'p') setPrinting(true);
    else if (key === 'f') setFind({ replace: false });
    else if (key === 'h') setFind({ replace: true });
    else if (key === 'k' && !readonly()) void openLinkDialog();
    else if (key === 'm' && !readonly()) void commands.addSlide();
    else if (key === 'e' && !readonly()) void commands.align('center');
    else if (key === 'l' && !readonly()) void commands.align('left');
    else if (key === 'r' && !readonly()) void commands.align('right');
    else if (key === 'j' && !readonly()) void commands.align('justify');
    else if ((e.key === '>' || e.key === '.') && e.shiftKey && !readonly())
      void commands.stepSize(1);
    else if ((e.key === '<' || e.key === ',') && e.shiftKey && !readonly())
      void commands.stepSize(-1);
    else if ((e.key === '=' || e.key === '+') && e.shiftKey && !readonly())
      void commands.toggleBaseline('super');
    else if (e.key === '=' && !readonly()) void commands.toggleBaseline('sub');
    else if (['b', 'i', 'u'].includes(key) && !readonly())
      void commands.toggle(
        ({ b: 'bold', i: 'italic', u: 'underline' } as const)[
          key as 'b' | 'i' | 'u'
        ]
      );
    else return false;
    return true;
  };

  const onStageKeyDown = (e: KeyboardEvent) => {
    if (e.target === input) return;
    const key = e.key;
    if (key === 'Escape' && painter.active()) {
      e.preventDefault();
      painter.cancel();
      return;
    }
    if (sharedShortcut(e)) {
      e.preventDefault();
      return;
    }
    if (isMod(e)) {
      const lower = key.toLowerCase();
      if (lower === 'a') {
        e.preventDefault();
        editor.selectAll();
      } else if (lower === 'g' && !readonly()) {
        e.preventDefault();
        void (e.shiftKey ? commands.ungroup() : commands.group());
      } else if (lower === 'd' && !readonly()) {
        e.preventDefault();
        void editor.duplicateSelected();
      } else if ((key === ']' || key === '}') && !readonly()) {
        e.preventDefault();
        commands.arrange(e.shiftKey ? 'front' : 'forward');
      } else if ((key === '[' || key === '{') && !readonly()) {
        e.preventDefault();
        commands.arrange(e.shiftKey ? 'back' : 'backward');
      } else if (key === '=' || key === '+') {
        e.preventDefault();
        zoomBy(1.25);
      } else if (key === '-') {
        e.preventDefault();
        zoomBy(1 / 1.25);
      } else if (key === '0') {
        e.preventDefault();
        setZoom('fit');
      }
      return;
    }
    if (key === 'PageDown' || key === 'PageUp') {
      e.preventDefault();
      editor.goToSlide(session.slideIndex() + (key === 'PageDown' ? 1 : -1));
      return;
    }
    if (key === 'Tab') {
      // Tab walks through the shapes on the slide, as in PowerPoint.
      const shapes = session.currentSlide()?.shapes ?? [];
      if (shapes.length === 0) return;
      e.preventDefault();
      const at = shapes.findIndex((s) => s.id === editor.selected());
      const next = (at + (e.shiftKey ? -1 : 1) + shapes.length) % shapes.length;
      editor.select(shapes[at < 0 && e.shiftKey ? shapes.length - 1 : next].id);
      return;
    }
    if (key === 'Escape' && find()) {
      e.preventDefault();
      setFind(null);
      return;
    }
    const list = editor.selection();
    if (list.length === 0 && !tableRange()) return;
    if (key === 'Escape') {
      e.preventDefault();
      if (tableRange()) setTableRange(null);
      else editor.setSelection([]);
    } else if (readonly()) {
      return;
    } else if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      const range = tableRange();
      const t = tableTarget();
      if (range && t) {
        // Clears the selected cells' text, as PowerPoint does.
        void commands.tableOp((slideId, target) =>
          commands.cellsOf(target).map((cell) => ({
            op: 'setText' as const,
            slide: slideId,
            shape: target.shape.id,
            cell,
            text: '',
          }))
        );
      } else {
        void editor.deleteSelected();
      }
    } else if (key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : e.altKey ? 0.5 : 1;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      void editor.nudge(dx, dy);
    } else if (key === 'Enter' || key === 'F2') {
      const shape = editor.selectedShape();
      if (shape?.kind === 'table') {
        e.preventDefault();
        void editCell(shape, tableRange()?.from ?? { row: 0, col: 0 });
      } else if (shape?.textEditable) {
        e.preventDefault();
        void startEditing(shape.id);
      }
    } else if (
      key.length === 1 &&
      !e.altKey &&
      list.length === 1 &&
      list[0].textEditable
    ) {
      // Typing on a selected shape replaces its text, as in PowerPoint.
      e.preventDefault();
      const id = list[0].id;
      void (async () => {
        await startEditing(id);
        await editor.typeText(key);
      })();
    }
  };

  let root!: HTMLDivElement;
  // Shortcuts work wherever focus is in the editor (a ribbon button, the
  // page itself after a menu closed), not only on the slide.
  onMount(() => {
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || presenting() !== null) return;
      const active = document.activeElement as HTMLElement | null;
      const inField =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        !!active?.isContentEditable;
      if (inField) return;
      const inEditor =
        !active || active === document.body || root.contains(active);
      if (!inEditor || active === stage) return;
      if (active?.closest('[role="menu"],[role="dialog"]')) return;
      // Buttons keep their own Enter, Space, and Tab behavior.
      const onControl = active && active !== document.body;
      if (onControl && ['Enter', ' ', 'Tab'].includes(e.key)) return;
      onStageKeyDown(e);
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onDocumentKeyDown));
  });

  const onInputKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const key = e.key;
    const mod = isMod(e);
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === 'Escape' && painter.active()) {
      handled();
      painter.cancel();
    } else if (key === 'Escape') {
      handled();
      const edit = editor.editing();
      stopEditing();
      if (edit) editor.select(edit.shape);
    } else if (key === 'Tab' && editor.editing()?.cell) {
      handled();
      void tabCell(e.shiftKey ? -1 : 1);
    } else if (key === 'Enter') {
      handled();
      void editor.typeText(e.shiftKey ? '\u000b' : '\n');
    } else if (key === 'Backspace' || key === 'Delete') {
      handled();
      const unit = e.metaKey ? 'line' : e.altKey || e.ctrlKey ? 'word' : 'char';
      void editor.deleteText(key === 'Backspace' ? -1 : 1, unit);
    } else if (key.startsWith('Arrow') || key === 'Home' || key === 'End') {
      handled();
      const dir = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
        Home: 'home',
        End: 'end',
      } as const;
      void editor.moveCaret(dir[key as keyof typeof dir], {
        extend: e.shiftKey,
        word: e.altKey || e.ctrlKey,
        line: e.metaKey,
      });
    } else if (key === 'Tab') {
      handled();
      const level = commands.paragraphStyle()?.level ?? 0;
      void editor.formatWith((t, range) =>
        paragraphCommand(t, range ?? null, {
          level: Math.max(0, Math.min(8, level + (e.shiftKey ? -1 : 1))),
        })
      );
    } else if (mod && key.toLowerCase() === 'a') {
      handled();
      editor.selectAllText();
    } else if (sharedShortcut(e)) {
      handled();
    }
  };

  const onBeforeInput = (e: InputEvent) => {
    if (e.isComposing || e.inputType === 'insertCompositionText') return;
    e.preventDefault();
    const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
    if (e.inputType.startsWith('insert') && text) void editor.typeText(text);
  };

  const onCompositionEnd = (e: CompositionEvent) => {
    if (e.data) void editor.typeText(e.data);
    input.value = '';
  };

  // Text clipboard while typing.
  const onTextCopy = (e: ClipboardEvent) => {
    e.preventDefault();
    e.clipboardData?.setData('text/plain', editor.selectedText());
  };
  const onTextCut = (e: ClipboardEvent) => {
    onTextCopy(e);
    // A collapsed caret has nothing to cut; deleting would eat a character.
    if (editor.selectedText()) void editor.deleteText(-1);
  };
  const onTextPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (text) void editor.typeText(text);
  };

  // Shape and slide clipboard.
  const onStageCopy = (e: ClipboardEvent) => {
    if (e.target === input) return;
    if (clipboard.copy(e.clipboardData)) e.preventDefault();
  };
  const onStageCut = (e: ClipboardEvent) => {
    if (e.target === input || readonly()) return;
    e.preventDefault();
    void clipboard.cut(e.clipboardData);
  };
  const onStagePaste = (e: ClipboardEvent) => {
    if (e.target === input || readonly()) return;
    e.preventDefault();
    void clipboard.pasteEvent(e.clipboardData);
  };
  const copyCommand = () => {
    if (editor.editing()) {
      document.execCommand('copy');
      return;
    }
    clipboard.copy();
  };
  const cutCommand = () => {
    if (editor.editing()) {
      document.execCommand('cut');
      return;
    }
    void clipboard.cut();
  };
  const pasteCommand = () => void clipboard.pasteCommand();

  // ---- panes, find, slide show -----------------------------------------------

  const [notesVisible, setNotesVisible] = createSignal(true);
  const [pane, setPane] = createSignal<PaneSection | null>(null);
  const [find, setFind] = createSignal<{ replace: boolean } | null>(null);
  // ---- animations -----------------------------------------------------------

  const [ribbonTab, setRibbonTab] = createSignal('home');
  const [animationPane, setAnimationPane] = createSignal(false);
  const [selectionPane, setSelectionPane] = createSignal(false);
  // ---- video and audio ------------------------------------------------------
  const mediaUrls = createMediaUrls(engine);
  /** The media shape playing over the stage. */
  const [playing, setPlaying] = createSignal<number>();
  /** The one selected video or audio shape, outside text editing. */
  const selectedMedia = () => {
    const shape = editor.selectedShape();
    return shape?.media && !editor.editing() ? shape : undefined;
  };
  function toggleSelectionPane() {
    const next = !selectionPane();
    if (next) {
      setAnimationPane(false);
      setPane(null);
    }
    setSelectionPane(next);
  }
  const [previewing, setPreviewing] = createSignal(false);
  /** The animation picked in the pane, on its slide. */
  const [pickedAnimation, setPickedAnimation] = createSignal<{
    slide: number;
    index: number;
  } | null>(null);
  const slideAnimations = () => session.currentSlide()?.animations ?? [];
  const picked = () => {
    const p = pickedAnimation();
    return p &&
      p.slide === session.currentSlide()?.id &&
      p.index < slideAnimations().length
      ? p.index
      : undefined;
  };
  /** Animations of the selected shapes (a group's members count). */
  const selectionAnimations = () => {
    const ids = new Set<number>();
    const add = (s: ShapeOutline) => {
      ids.add(s.id);
      for (const c of s.children ?? []) add(c);
    };
    for (const s of ribbonSelection()) add(s);
    return slideAnimations()
      .map((a, i) => (ids.has(a.shapeId) ? i : -1))
      .filter((i) => i >= 0);
  };
  const animationEnv = {
    pane: animationPane,
    togglePane: () => setAnimationPane((v) => !v),
    picked,
    pick: (index?: number) => {
      const slide = session.currentSlide();
      setPickedAnimation(
        index === undefined || !slide ? null : { slide: slide.id, index }
      );
    },
    current: () => picked() ?? selectionAnimations()[0],
    selected: () => {
      const p = picked();
      return p !== undefined ? [p] : selectionAnimations();
    },
    preview: () => {
      editor.stopEditing();
      setPreviewing(true);
    },
  };
  const showAnimationTags = () =>
    (ribbonTab() === 'animations' || animationPane()) &&
    slideAnimations().length > 0;

  const [printing, setPrinting] = createSignal(false);
  /** What the Insert/Edit Link dialog links, while it is open. */
  const [linkEdit, setLinkEdit] = createSignal<LinkTarget>();
  async function openLinkDialog() {
    if (readonly()) return;
    // The dialog starts from the text as it is once typing has landed.
    await editor.textSettled();
    const target = commands.linkTarget();
    if (target) setLinkEdit(target);
  }
  /** Follows a link from the editor: a web page in a new tab, or a slide. */
  const followLink = (link: string) => {
    const deck = session.outline();
    if (!deck) return;
    const action = linkAction(link, deck, session.slideIndex());
    if (action.kind === 'slide') editor.goToSlide(action.index);
    else if (action.kind === 'open')
      window.open(action.url, '_blank', 'noopener,noreferrer');
  };
  /** The link of what was right-clicked (the text at the caret, or the shape). */
  const menuLink = () => {
    const target = menuTarget();
    if (target.kind === 'canvas') return undefined;
    return commands.linkTarget()?.link;
  };
  const [sorter, setSorterRaw] = createSignal(false);
  const setSorter = (on: boolean) => {
    if (on) {
      editor.stopEditing();
      editor.setSelection([]);
    }
    setSorterRaw(on);
    queueMicrotask(() =>
      on
        ? document
            .querySelector<HTMLElement>(
              '[data-testid="pptx-slide-sorter"] [data-testid="pptx-slide-list"]'
            )
            ?.focus()
        : focusStage()
    );
  };
  /** Double-click in the sorter: back to Normal view on that slide. */
  const openFromSorter = (index: number) => {
    setSorter(false);
    editor.goToSlide(index);
  };
  const [presenting, setPresenting] = createSignal<{
    start: number;
    presenter: boolean;
  } | null>(null);
  const present = (fromCurrent: boolean, presenter = false) => {
    editor.stopEditing();
    setPresenting({
      start: fromCurrent ? session.slideIndex() : 0,
      presenter,
    });
  };
  const [recentFonts, setRecentFonts] = createSignal<string[]>([]);
  const setFont = commands.setFont;
  commands.setFont = (font: string) => {
    if (!font.startsWith('+'))
      setRecentFonts((list) =>
        [font, ...list.filter((f) => f !== font)].slice(0, 5)
      );
    return setFont(font);
  };

  /** The chart whose data editor is open. */
  const [chartDataShape, setChartDataShape] = createSignal<number | null>(null);
  const chartEditor = (shape: ShapeOutline) => setChartDataShape(shape.id);

  let replacePictureInput!: HTMLInputElement;
  const replacePicture = (file: File) => commands.replaceImage(file);

  const download = async () => {
    try {
      context.download(await engine.save(), context.fileName());
    } catch {
      context.notifyError('The presentation could not be exported.');
    }
  };

  // ---- overlay geometry --------------------------------------------------

  const overlay = () => {
    const edit = editor.editing();
    const d = editor.drag();
    const list = editor.selection();
    const multiple = list.length > 1;
    const bounds = multiple ? unionBounds(list.map(boxOf)) : undefined;
    const range = tableRange();
    const rangeShape = range && editor.findShape(range.shape);
    const g = rangeShape && tableGeometry(rangeShape);
    const guide = borderGuide();
    const guideShape = guide && editor.findShape(guide.shape);
    const guideGeometry = guideShape && tableGeometry(guideShape);
    return {
      selection: edit?.bounds
        ? edit.bounds
        : multiple && bounds
          ? ({ ...bounds, rotation: 0 } as Box)
          : list[0]
            ? boxOf(list[0])
            : undefined,
      outlines: multiple ? list.map(boxOf) : undefined,
      rotatable: list.length === 1,
      previews:
        d?.active && d.kind !== 'marquee'
          ? d.kind === 'move' && d.shape !== undefined && editor.images().layer
            ? []
            : editor.dragBoxes(d).map((b) => b.box)
          : [],
      marquee: editor.marquee(),
      cellRange:
        range && rangeShape && g
          ? rangeBox(rangeShape, g, range.from, range.to)
          : undefined,
      guide:
        guide?.kind === 'border' && guideGeometry
          ? guide.axis === 'col'
            ? {
                x1:
                  guideGeometry.xs[guide.index + 1] +
                  guide.current.x -
                  guide.start.x,
                x2:
                  guideGeometry.xs[guide.index + 1] +
                  guide.current.x -
                  guide.start.x,
                y1: guideGeometry.ys[0],
                y2: guideGeometry.ys[guideGeometry.ys.length - 1],
              }
            : {
                x1: guideGeometry.xs[0],
                x2: guideGeometry.xs[guideGeometry.xs.length - 1],
                y1:
                  guideGeometry.ys[guide.index + 1] +
                  guide.current.y -
                  guide.start.y,
                y2:
                  guideGeometry.ys[guide.index + 1] +
                  guide.current.y -
                  guide.start.y,
              }
          : undefined,
      caret:
        edit?.layout &&
        edit.selection.anchor.paragraph === edit.selection.focus.paragraph &&
        edit.selection.anchor.offset === edit.selection.focus.offset
          ? (caretSegment(edit.layout, edit.selection.focus) ?? undefined)
          : undefined,
      textSelection: edit?.layout
        ? selectionQuads(
            edit.layout,
            edit.selection.anchor,
            edit.selection.focus
          )
        : undefined,
    };
  };

  // Keep the hidden input next to the caret so IME candidate windows appear there.
  const inputPosition = () => {
    const caret = overlay().caret;
    const s = scale();
    return caret
      ? { left: `${caret[0].x * s}px`, top: `${caret[0].y * s}px` }
      : { left: '0px', top: '0px' };
  };

  // Leaving a slide ends text editing, cell ranges, and the cell editor.
  createEffect(
    on(
      session.slideIndex,
      () => {
        setCellEdit(null);
        setTableRange(null);
      },
      { defer: true }
    )
  );

  const themeColors = () => session.outline()?.themeColors ?? [];
  const swatches = () => [
    ...themeSwatches(themeColors()),
    ...STANDARD_SWATCHES,
  ];

  // ---- ribbon --------------------------------------------------------------

  const ribbonSelection = () => {
    const edit = editor.editing();
    const shape = edit && editor.findShape(edit.shape);
    return shape ? [shape] : editor.selection();
  };
  const env: RibbonEnv = {
    commands,
    readonly,
    deck: session.outline,
    slide: session.currentSlide,
    selection: ribbonSelection,
    editingText: () => !!editor.editing(),
    themeGrid: () => themeGrid(themeColors()),
    standardColors: STANDARD_SWATCHES,
    presetPaths: engine.presetPaths,
    history: session.history,
    undo: () => void undo(),
    redo: () => void redo(),
    copy: copyCommand,
    cut: cutCommand,
    paste: pasteCommand,
    formatPainter: painter,
    openFormatPane: (section) => setPane(section ?? 'shape'),
    openLink: () => void openLinkDialog(),
    selectionPane: { open: selectionPane, toggle: toggleSelectionPane },
    view,
    present,
    find: (replace) => setFind({ replace }),
    zoom,
    setZoom,
    sorter,
    setSorter,
    animation: animationEnv,
    notesVisible,
    toggleNotes: () => setNotesVisible((v) => !v),
    download: () => void download(),
    recentFonts,
    deckSetup,
  };

  const tableTabProps = () => {
    const table = selectedTable();
    return table
      ? {
          table,
          styles: session.outline()?.tableStyles ?? [],
          selectRows: selectWholeRows,
          selectColumns: selectWholeColumns,
          selectTable: selectWholeTable,
        }
      : undefined;
  };

  const chartInsertMenu = (close: () => void) => (
    <ChartGallery
      onPick={(choice) => {
        close();
        void (async () => {
          const id = await commands.insertChart(
            choice.kind,
            choice.grouping,
            sampleChartData()
          );
          if (id !== undefined) setChartDataShape(id);
        })();
      }}
    />
  );
  const chartTab: RibbonTab = {
    id: 'chart-design',
    label: 'Chart Design',
    contextual: true,
    content: () => (
      <Show
        when={
          editor.selectedShape()?.kind === 'chart'
            ? editor.selectedShape()
            : undefined
        }
      >
        {(shape) => (
          <ChartDesignTab
            shape={shape()}
            onEditData={() => setChartDataShape(shape().id)}
          />
        )}
      </Show>
    ),
  };
  const transitionsTab: RibbonTab = {
    id: 'transitions',
    label: 'Transitions',
    content: () => <TransitionsTab />,
  };

  const tabs = createMemo((): RibbonTab[] => {
    const list = ribbonSelection();
    const table = !!selectedTable();
    const drawable = list.some(
      (s) => s.kind !== 'table' && s.kind !== 'chart' && s.kind !== 'picture'
    );
    const pictures = list.some((s) => s.kind === 'picture');
    return [
      { id: 'home', label: 'Home', content: () => <HomeTab /> },
      {
        id: 'insert',
        label: 'Insert',
        content: () => <InsertTab chartMenu={chartInsertMenu} />,
      },
      { id: 'design', label: 'Design', content: () => <DesignTab /> },
      transitionsTab,
      {
        id: 'animations',
        label: 'Animations',
        content: () => <AnimationsTab />,
      },
      { id: 'slideshow', label: 'Slide Show', content: () => <SlideShowTab /> },
      { id: 'view', label: 'View', content: () => <ViewTab /> },
      ...(drawable && !readonly()
        ? [
            {
              id: 'shape-format',
              label: 'Shape Format',
              contextual: true,
              content: () => <ShapeFormatTab />,
            },
          ]
        : []),
      ...(pictures && !readonly()
        ? [
            {
              id: 'picture-format',
              label: 'Picture Format',
              contextual: true,
              content: () => (
                <PictureFormatTab
                  images={pictureImages}
                  crop={crop}
                  onChangePicture={() => replacePictureInput.click()}
                />
              ),
            },
          ]
        : []),
      ...(table && !readonly()
        ? [
            {
              id: 'table-design',
              label: 'Table Design',
              contextual: true,
              content: () => (
                <Show when={tableTabProps()}>
                  {(p) => <TableDesignTab {...p()} />}
                </Show>
              ),
            },
            {
              id: 'table-layout',
              label: 'Layout',
              contextual: true,
              content: () => (
                <Show when={tableTabProps()}>
                  {(p) => <TableLayoutTab {...p()} />}
                </Show>
              ),
            },
          ]
        : []),
      ...(list.length === 1 && list[0].kind === 'chart' && !readonly()
        ? [chartTab]
        : []),
    ];
  });

  const saveLabel = () =>
    ({
      saved: 'Saved',
      dirty: 'Unsaved changes',
      saving: 'Saving…',
      error: 'Save failed',
    })[session.saveState()];

  // ---- slide rail menu -----------------------------------------------------

  /** The slide rail, or with `grid` the slide sorter. */
  const Slides = (props: { grid?: boolean }) => (
    <>
      <Show when={session.outline()}>
        {(deck) => (
          <SlideRail
            slides={deck().slides}
            current={session.slideIndex()}
            aspect={slideH() / slideW()}
            thumbnail={thumbnails.thumbnail}
            thumbnailPixels={Math.round(thumbnailWidth() * dpr())}
            readonly={readonly()}
            selectedIds={selectedSlideIds()}
            grid={props.grid}
            onSelect={selectSlide}
            onSelectAll={selectAllSlides}
            onOpen={props.grid ? openFromSorter : undefined}
            onMove={(ids, at) => void commands.moveSlides(ids, at)}
            onAdd={() => void commands.addSlide()}
            onDuplicate={(id) => void commands.duplicateSlide(id)}
            onDelete={(ids) => void commands.deleteSlides(ids)}
            onToggleHidden={(s) => void commands.toggleHidden(s)}
            peersOn={collaboration ? peersOn : undefined}
            menu={railMenu}
            onCopy={(e) => {
              if (clipboard.copy(e.clipboardData)) e.preventDefault();
            }}
            onCut={(e) => {
              if (readonly()) return;
              e.preventDefault();
              void clipboard.cut(e.clipboardData);
            }}
            onPaste={(e) => {
              if (readonly()) return;
              e.preventDefault();
              void clipboard.pasteEvent(e.clipboardData);
            }}
            onFocusChange={setRailFocused}
            sectionHeaders={(index) => (
              <SectionHeaders
                setup={deckSetup}
                before={index()}
                grid={props.grid}
                readonly={readonly()}
              />
            )}
            slideHidden={deckSetup.sections.hidden}
            sectionMenu={(id) => (
              <SectionMenuItems
                setup={deckSetup}
                id={id}
                readonly={readonly()}
              />
            )}
          />
        )}
      </Show>
    </>
  );

  const many = () => selectedSlideIds().length > 1;
  const railMenu = (slide: SlideOutline | undefined) => (
    <>
      <Show when={slide}>
        <MenuItem
          text="Cut"
          icon={Scissors}
          shortcut="cmd+x"
          disabled={readonly() || (session.outline()?.slides.length ?? 0) <= 1}
          onClick={() => {
            setRailFocused(true);
            cutCommand();
          }}
        />
        <MenuItem
          text="Copy"
          icon={CopyIcon}
          shortcut="cmd+c"
          onClick={() => {
            setRailFocused(true);
            copyCommand();
          }}
        />
      </Show>
      <MenuItem
        text="Paste"
        icon={ClipboardIcon}
        shortcut="cmd+v"
        disabled={readonly()}
        onClick={pasteCommand}
      />
      <MenuSeparator />
      <MenuItem
        text="New slide"
        icon={Plus}
        shortcut="cmd+m"
        disabled={readonly()}
        onClick={() => void commands.addSlide(undefined, slide?.id)}
      />
      <Show when={slide}>
        {(s) => (
          <>
            <MenuItem
              text={many() ? 'Duplicate slides' : 'Duplicate slide'}
              icon={CopySimple}
              disabled={readonly()}
              onClick={() => void commands.duplicateSlide(s().id)}
            />
            <MenuItem
              text={many() ? 'Delete slides' : 'Delete slide'}
              icon={Trash}
              disabled={
                readonly() ||
                selectedSlideIds().length >=
                  (session.outline()?.slides.length ?? 0)
              }
              onClick={() => void commands.deleteSlides(selectedSlideIds())}
            />
            <MenuItem
              text="Add Section"
              disabled={readonly()}
              onClick={() => void deckSetup.sections.add(s().id)}
            />
            <MenuSeparator />
            <ContextMenu.Sub overlap gutter={2}>
              <ContextMenu.SubTrigger class="group flex w-full cursor-default items-center gap-1.5 rounded-lg p-1.5 px-2 text-left text-ink text-sm outline-none data-[highlighted]:bg-ink/5">
                Layout
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenuContent submenu class="w-56">
                  <For each={session.outline()?.layouts ?? []}>
                    {(layout) => (
                      <MenuItem
                        text={layout.name}
                        disabled={readonly()}
                        onClick={() => void commands.setLayout(layout.name)}
                      />
                    )}
                  </For>
                </ContextMenuContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
            <MenuItem
              text="Format background…"
              icon={PaintBucket}
              disabled={readonly()}
              onClick={() => setPane('background')}
            />
            <MenuItem
              text={
                (s().hidden ? 'Unhide slide' : 'Hide slide') +
                (many() ? 's' : '')
              }
              icon={EyeSlash}
              disabled={readonly()}
              onClick={() => void commands.toggleHidden(s())}
            />
          </>
        )}
      </Show>
    </>
  );

  return (
    <div
      ref={root}
      class="flex size-full min-h-0 flex-col bg-page"
      data-testid="pptx-editor"
    >
      <Ribbon
        env={env}
        tabs={tabs()}
        keepFocus={!!editor.editing()}
        onTabChange={setRibbonTab}
        start={
          <Show when={!readonly()}>
            <RibbonButton
              label="Undo"
              tooltip="Undo (⌘Z)"
              disabled={!session.history().canUndo}
              onClick={() => void undo()}
            >
              <ArrowCounterClockwise />
            </RibbonButton>
            <RibbonButton
              label="Redo"
              tooltip="Redo (⇧⌘Z)"
              disabled={!session.history().canRedo}
              onClick={() => void redo()}
            >
              <ArrowClockwise />
            </RibbonButton>
            <div class="mx-1 h-4 w-px bg-edge-muted" />
          </Show>
        }
        end={
          <div class="flex items-center gap-1">
            <Show when={!readonly()}>
              <button
                type="button"
                class="flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-muted text-xs hover:bg-ink/5"
                data-testid="pptx-save-state"
                title="Save (⌘S)"
                onClick={() => void session.save().catch(() => {})}
              >
                <Show
                  when={session.saveState() === 'error'}
                  fallback={<CloudCheck class="size-3.5" />}
                >
                  <WarningIcon class="size-3.5 text-failure" />
                </Show>
                {saveLabel()}
              </button>
            </Show>
            <RibbonButton
              label="Print"
              tooltip="Print or save as PDF (⌘P)"
              data-testid="pptx-print-open"
              onClick={() => setPrinting(true)}
            >
              <Printer />
            </RibbonButton>
            <RibbonButton
              label="Download"
              tooltip="Download .pptx"
              onClick={() => void download()}
            >
              <DownloadSimple />
            </RibbonButton>
            <Button
              size="sm"
              variant="accent"
              class="h-6 gap-1 px-2 text-xs"
              label="Present"
              tooltip="Present from current slide (⇧F5)"
              data-testid="pptx-present"
              onClick={() => present(true)}
            >
              <Play class="size-3" />
              Present
            </Button>
          </div>
        }
      />
      <div class="flex min-h-0 flex-1">
        <Show when={!sorter()}>
          <Slides />
        </Show>
        <div class="flex min-w-0 flex-1 flex-col">
          <Show when={sorter()}>
            <Slides grid />
          </Show>
          <div
            class="relative flex min-h-0 flex-1"
            classList={{ hidden: sorter() }}
          >
            <Show
              when={previewing() && session.outline() && session.currentSlide()}
            >
              <AnimationPreview
                engine={engine}
                deck={session.outline()!}
                index={session.slideIndex()}
                width={hostSize().w - 2 * STAGE_MARGIN}
                height={hostSize().h - 2 * STAGE_MARGIN}
                onDone={() => setPreviewing(false)}
              />
            </Show>
            <div
              ref={stageHost}
              class="relative min-h-0 min-w-0 flex-1 overflow-auto bg-inset"
              onWheel={(e) => {
                if (!e.ctrlKey && !e.metaKey) return;
                e.preventDefault();
                zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
              }}
            >
              <Show when={collaboration}>
                {(c) => (
                  <Collaborators peers={c().peers()} status={c().status()} />
                )}
              </Show>
              <Show when={find()}>
                {(f) => (
                  <FindReplace
                    replace={f().replace}
                    readonly={readonly()}
                    session={session}
                    editor={editor}
                    commands={commands}
                    onReplaceMode={(replace) => setFind({ replace })}
                    onClose={() => {
                      setFind(null);
                      refocus();
                    }}
                  />
                )}
              </Show>
              <div
                class="flex min-h-full min-w-full items-center justify-center"
                style={{
                  width:
                    zoom() === 'fit'
                      ? undefined
                      : `${slideW() * scale() + 2 * STAGE_MARGIN}px`,
                  height:
                    zoom() === 'fit'
                      ? undefined
                      : `${slideH() * scale() + 2 * STAGE_MARGIN}px`,
                }}
              >
                <Show
                  when={session.outline() && scale() > 0}
                  fallback={
                    <div
                      class="text-ink-muted text-sm"
                      data-testid="pptx-loading"
                    >
                      {loadError()
                        ? `This presentation could not be opened: ${loadError()}`
                        : 'Opening presentation…'}
                    </div>
                  }
                >
                  <SlideStage
                    images={editor.images()}
                    cssWidth={slideW() * scale()}
                    cssHeight={slideH() * scale()}
                    pixelWidth={renderWidth()}
                    pixelsPerPoint={renderWidth() / slideW()}
                  >
                    <ContextMenu
                      onOpenChange={(open) => {
                        if (!open) queueMicrotask(refocus);
                      }}
                    >
                      <ContextMenu.Trigger
                        as="div"
                        ref={stage}
                        tabIndex={0}
                        data-testid="pptx-stage"
                        class="absolute inset-0 outline-none"
                        classList={{
                          'cursor-text':
                            !!editor.editing() && !painter.active(),
                        }}
                        style={{
                          cursor: painter.active() ? PAINT_CURSOR : undefined,
                        }}
                        data-format-painter={painter.active() || undefined}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={() => {
                          tableGesture = null;
                          setBorderGuide(null);
                          editor.cancelDrag();
                        }}
                        onDblClick={onDoubleClick}
                        onKeyDown={onStageKeyDown}
                        // Kobalte's trigger does not call onContextMenu; capture runs first.
                        oncapture:contextmenu={onContextMenu}
                        onCopy={onStageCopy}
                        onCut={onStageCut}
                        onPaste={onStagePaste}
                      >
                        <Show when={collaboration && session.currentSlide()}>
                          {(slide) => (
                            <PeerSelections
                              peers={collaboration?.peers() ?? []}
                              slide={slide()}
                              width={slideW()}
                              height={slideH()}
                              unit={unit()}
                            />
                          )}
                        </Show>
                        <Show
                          when={showAnimationTags() && session.currentSlide()}
                        >
                          {(slide) => (
                            <AnimationTags
                              slide={slide()}
                              width={slideW()}
                              height={slideH()}
                              unit={unit()}
                              picked={picked()}
                            />
                          )}
                        </Show>
                        <SelectionOverlay
                          width={slideW()}
                          height={slideH()}
                          unit={unit()}
                          selection={overlay().selection}
                          outlines={overlay().outlines}
                          showHandles={!readonly()}
                          rotatable={overlay().rotatable}
                          previews={overlay().previews}
                          marquee={overlay().marquee}
                          cellRange={overlay().cellRange}
                          guide={overlay().guide}
                          smartGuides={editor.guides() ?? undefined}
                          caret={overlay().caret}
                          textSelection={overlay().textSelection}
                          editing={!!editor.editing()}
                          onHandleDown={(kind, handle, e) => {
                            e.stopPropagation();
                            stage.setPointerCapture(e.pointerId);
                            editor.handleDown(kind, handle, toSlide(e));
                          }}
                        />
                        <textarea
                          ref={input}
                          data-testid="pptx-text-input"
                          aria-label="Slide text"
                          class="pointer-events-none absolute h-4 w-px resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
                          style={inputPosition()}
                          autocomplete="off"
                          spellcheck={false}
                          onKeyDown={onInputKeyDown}
                          onBeforeInput={onBeforeInput}
                          onCompositionEnd={onCompositionEnd}
                          onCopy={onTextCopy}
                          onCut={onTextCut}
                          onPaste={onTextPaste}
                        />
                        <Show when={cellEdit()}>
                          {(cell) => (
                            <textarea
                              id="pptx-cell-input"
                              data-testid="pptx-cell-input"
                              class="absolute z-10 resize-none rounded-sm border-2 border-accent bg-surface p-1 text-ink text-sm shadow-lg outline-none"
                              style={{
                                left: `${cell().rect.x * scale()}px`,
                                top: `${cell().rect.y * scale()}px`,
                                width: `${Math.max(80, cell().rect.w * scale())}px`,
                                height: `${Math.max(32, cell().rect.h * scale())}px`,
                              }}
                              value={cell().text}
                              ref={(el) => queueMicrotask(() => el.focus())}
                              onPointerDown={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  void commitCell(e.currentTarget.value);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setCellEdit(null);
                                }
                              }}
                              onBlur={(e) =>
                                void commitCell(e.currentTarget.value)
                              }
                            />
                          )}
                        </Show>
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenuContent class="w-64">
                          <StageMenuItems
                            target={menuTarget()}
                            a={{
                              commands,
                              readonly: readonly(),
                              copy: copyCommand,
                              cut: cutCommand,
                              paste: pasteCommand,
                              canPaste: true,
                              editText: () => {
                                const s = editor.selectedShape();
                                if (s) void startEditing(s.id);
                              },
                              openFormatPane: (section) =>
                                setPane(section ?? 'shape'),
                              replacePicture: () => replacePictureInput.click(),
                              crop: () => void crop.enter(),
                              editChartData: () => {
                                const s = editor.selectedShape();
                                if (s) chartEditor(s);
                              },
                              changeChartType: () => {
                                const s = editor.selectedShape();
                                if (s) chartEditor(s);
                              },
                              selectRows: selectWholeRows,
                              selectColumns: selectWholeColumns,
                              selectTable: selectWholeTable,
                              layouts: (session.outline()?.layouts ?? []).map(
                                (l) => l.name
                              ),
                              currentLayout: session.currentSlide()?.layout,
                              swatches: swatches(),
                              newSlide: () => void commands.addSlide(),
                              hideSlide: () => {
                                const s = session.currentSlide();
                                if (s) void commands.toggleHidden(s);
                              },
                              slideHidden: !!session.currentSlide()?.hidden,
                              isPicture:
                                editor.selectedShape()?.kind === 'picture',
                              isGroup: editor
                                .selection()
                                .some((s) => s.kind === 'group'),
                              selectionCount: editor.selection().length,
                              textShape: !!editor.selectedShape()?.textEditable,
                              link: menuLink(),
                              editLink: () => void openLinkDialog(),
                              openLink: followLink,
                              removeLink: () => {
                                const target = commands.linkTarget();
                                if (target) void commands.applyLink(target, '');
                              },
                            }}
                          />
                        </ContextMenuContent>
                      </ContextMenu.Portal>
                    </ContextMenu>
                    <Show when={view.options().gridlines}>
                      <Gridlines
                        width={slideW()}
                        height={slideH()}
                        scale={scale()}
                        spacing={view.options().gridSpacing}
                      />
                    </Show>
                    <Show when={view.options().ruler}>
                      <Rulers
                        width={slideW()}
                        height={slideH()}
                        scale={scale()}
                        selection={unionBounds(editor.selection().map(boxOf))}
                      />
                    </Show>
                    <Show when={selectedMedia()}>
                      {(shape) => {
                        const box = () => ({
                          x: shape().x * scale(),
                          y: shape().y * scale(),
                          w: shape().w * scale(),
                          h: shape().h * scale(),
                        });
                        return (
                          <Show
                            when={playing() === shape().id && shape().media}
                            fallback={
                              <MediaPlayButton
                                box={box()}
                                kind={shape().media?.kind ?? 'video'}
                                onPlay={() => setPlaying(shape().id)}
                              />
                            }
                          >
                            {(media) => (
                              <MediaPlayer
                                media={media()}
                                box={box()}
                                urls={mediaUrls}
                                onEnded={() => setPlaying(undefined)}
                              />
                            )}
                          </Show>
                        );
                      }}
                    </Show>
                    <Show when={crop.active()}>
                      <CropOverlay
                        crop={crop}
                        images={pictureImages}
                        themeColors={themeColors()}
                        scale={scale()}
                      />
                    </Show>
                  </SlideStage>
                </Show>
              </div>
            </div>
            <Show
              when={
                selectionPane() &&
                !animationPane() &&
                !pane() &&
                session.currentSlide()
              }
            >
              {(slide) => (
                <SelectionPane
                  slide={slide()}
                  selectedIds={editor.selectedIds()}
                  readonly={readonly()}
                  onSelect={(id, toggle) =>
                    toggle ? editor.toggleSelected(id) : editor.select(id)
                  }
                  onRename={(id, name) => void commands.renameShape(id, name)}
                  onHide={(ids, hidden) =>
                    void commands.setShapesHidden(ids, hidden)
                  }
                  onMove={(id, steps) => void commands.moveInZOrder(id, steps)}
                  onClose={() => {
                    setSelectionPane(false);
                    refocus();
                  }}
                />
              )}
            </Show>
            <Show when={animationPane() && !pane()}>
              <AnimationPane
                env={env}
                onSelectShape={(id) => {
                  const top = session
                    .currentSlide()
                    ?.shapes.find(
                      (s) =>
                        s.id === id ||
                        (s.children ?? []).some((c) => c.id === id)
                    );
                  if (top) editor.select(top.id);
                }}
                onClose={() => {
                  setAnimationPane(false);
                  refocus();
                }}
              />
            </Show>
            <Show when={pane()}>
              {(section) => (
                <FormatPane
                  section={section()}
                  onSection={setPane}
                  onClose={() => {
                    setPane(null);
                    refocus();
                  }}
                  env={env}
                />
              )}
            </Show>
          </div>
          <Show when={notesVisible() && !sorter() && session.currentSlide()}>
            {(slide) => (
              <NotesPanel
                slideId={slide().id}
                notes={slide().notes ?? ''}
                readonly={readonly()}
                onCommit={(slideId, text) => {
                  const current = session
                    .outline()
                    ?.slides.find((s) => s.id === slideId);
                  if ((current?.notes ?? '') !== text)
                    void session.apply([
                      { op: 'setNotes', slide: slideId, text },
                    ]);
                }}
              />
            )}
          </Show>
          <div class="flex h-6 shrink-0 items-center gap-3 border-edge-muted border-t bg-panel px-3 text-ink-muted text-xs">
            <span data-testid="pptx-status-slide">
              Slide {session.slideIndex() + 1} of{' '}
              {session.outline()?.slides.length ?? 0}
            </span>
            <Show when={selectedSlideIds().length > 1}>
              <span data-testid="pptx-status-selected">
                {selectedSlideIds().length} slides selected
              </span>
            </Show>
            <span class="flex-1" />
            <button
              type="button"
              class="hover:text-ink"
              onClick={() => setNotesVisible((v) => !v)}
            >
              Notes
            </button>
            <button
              type="button"
              class="hover:text-ink"
              classList={{ 'text-ink': !sorter() }}
              aria-pressed={!sorter()}
              aria-label="Normal view"
              title="Normal"
              data-testid="pptx-view-normal"
              onClick={() => setSorter(false)}
            >
              <Rectangle class="size-3.5" />
            </button>
            <button
              type="button"
              class="hover:text-ink"
              classList={{ 'text-ink': sorter() }}
              aria-pressed={sorter()}
              aria-label="Slide sorter"
              title="Slide sorter"
              data-testid="pptx-view-sorter"
              onClick={() => setSorter(true)}
            >
              <SquaresFour class="size-3.5" />
            </button>
            <Show when={!sorter()}>
              <button
                type="button"
                class="hover:text-ink"
                aria-label="Zoom out"
                onClick={() => zoomBy(1 / 1.25)}
              >
                −
              </button>
              <input
                type="range"
                aria-label="Zoom"
                min={10}
                max={400}
                value={Math.round((scale() / PX_PER_PT) * 100)}
                class="w-24 accent-accent"
                onInput={(e) => setZoom(Number(e.currentTarget.value) / 100)}
              />
              <button
                type="button"
                class="hover:text-ink"
                aria-label="Zoom in"
                onClick={() => zoomBy(1.25)}
              >
                +
              </button>
              <button
                type="button"
                class="w-10 text-right tabular-nums hover:text-ink"
                title="Fit slide to window"
                data-testid="pptx-zoom"
                onClick={() => setZoom('fit')}
              >
                {Math.round((scale() / PX_PER_PT) * 100)}%
              </button>
            </Show>
          </div>
        </div>
      </div>
      <input
        ref={replacePictureInput}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        class="hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void replacePicture(file);
        }}
      />
      <Show
        when={
          chartDataShape() !== null
            ? editor.findShape(chartDataShape()!)
            : undefined
        }
      >
        {(shape) => (
          <ChartDataEditor
            shape={shape()}
            readonly={readonly()}
            onApply={(data) => commands.setChartData(shape().id, data)}
            onClose={() => {
              setChartDataShape(null);
              queueMicrotask(focusStage);
            }}
          />
        )}
      </Show>
      <Show when={linkEdit() && session.outline()}>
        {(deck) => (
          <LinkDialog
            engine={engine}
            deck={deck()}
            current={session.slideIndex()}
            target={linkEdit()!}
            onApply={(link, tip, text) => {
              const target = linkEdit();
              if (target) void commands.applyLink(target, link, tip, text);
            }}
            onClose={() => {
              setLinkEdit(undefined);
              queueMicrotask(refocus);
            }}
          />
        )}
      </Show>
      <Show when={printing() && session.outline()}>
        {(deck) => (
          <PrintDialog
            engine={engine}
            deck={deck()}
            current={session.slideIndex()}
            fileName={context.fileName()}
            download={context.download}
            notifyError={context.notifyError}
            onClose={() => {
              setPrinting(false);
              queueMicrotask(refocus);
            }}
          />
        )}
      </Show>
      <DeckSetupDialogs
        setup={deckSetup}
        deck={session.outline()}
        slide={session.currentSlide()}
        selectedCount={selectedSlideIds().length}
        readonly={readonly()}
        onClosed={() => queueMicrotask(refocus)}
      />
      <Show when={presenting() && session.outline()}>
        {(deck) => {
          const onExit = (index: number) => {
            setPresenting(null);
            editor.goToSlide(index);
            queueMicrotask(focusStage);
          };
          return (
            <Show
              when={presenting()?.presenter}
              fallback={
                <SlideShow
                  engine={engine}
                  deck={deck()}
                  start={presenting()?.start ?? 0}
                  onExit={onExit}
                />
              }
            >
              <PresenterView
                engine={engine}
                deck={deck()}
                start={presenting()?.start ?? 0}
                onExit={onExit}
              />
            </Show>
          );
        }}
      </Show>
    </div>
  );
}
