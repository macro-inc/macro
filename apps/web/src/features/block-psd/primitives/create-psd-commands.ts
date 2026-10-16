/**
 * The editor's commands, as the menus, shortcuts, and panels run them:
 * clipboard, layers, masks, selections, canvas changes, filters and
 * adjustments (with their dialogs), exports, and the view. Each knows
 * whether it is available now.
 */

import type {
  Adjustment,
  FilterSpec,
  MaskInit,
  NewLayer,
  Op,
} from '@core/psd-engine/types';
import { createSignal } from 'solid-js';
import {
  defaultAdjustment,
  type EditableAdjustment,
} from '../core/adjustments';
import type { FilterKind } from '../core/filters';
import { twoColorGradient } from '../core/gradient';
import {
  clippingOp,
  mergeDownOp,
  newLayerOp,
  nextLayerName,
} from '../core/ops';
import { stepBrushSize } from '../core/shortcuts';
import type { CanvasTools } from './create-canvas-tools';
import type { PsdEditor } from './create-psd-editor';
import type { PsdView } from './create-psd-view';

/** A dialog the editor shows. */
export type EditorDialog =
  | { kind: 'imageSize' }
  | { kind: 'canvasSize' }
  | { kind: 'filter'; filter: FilterKind }
  /** Image > Adjustments: applied to the pixels. */
  | { kind: 'adjust'; adjustment: Adjustment }
  | { kind: 'feather' }
  | { kind: 'expand'; contract: boolean }
  | { kind: 'resolution' };

export interface PsdCommandsOptions {
  editor: PsdEditor;
  view: PsdView;
  tools: CanvasTools;
  fileName: () => string;
  download: (blob: Blob, name: string) => void;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
  /** A dialog closed: the keys go back to the editor. */
  onDialogClosed?: () => void;
}

const safeName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.(psd|psb)$/i, '')
    .trim() || 'image';

export function createPsdCommands(options: PsdCommandsOptions) {
  const { editor, view, tools } = options;
  const engine = editor.engine;
  const [dialog, setDialog] = createSignal<EditorDialog>();
  /** The pixels last copied here (when the system clipboard is closed). */
  let clipboard: Blob | undefined;

  const editable = () => editor.enabled();
  const active = () => editor.activeRow();
  const chosen = () => editor.selected();
  const pixelTarget = () => {
    const row = active();
    return row ? { id: row.id, target: editor.target() } : undefined;
  };

  // ---- clipboard ---------------------------------------------------------

  const writeClipboard = async (blob: Blob) => {
    clipboard = blob;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
    } catch {
      // Kept for pasting here; the system clipboard refused it.
    }
  };

  const copy = async (merged: boolean) => {
    const layer = merged ? undefined : active()?.id;
    if (!merged && layer === undefined) return;
    const blob = await editor.enqueue(() => engine.copyPixels(layer));
    if (blob) await writeClipboard(blob);
  };

  const cut = async () => {
    const t = pixelTarget();
    if (!t || !editor.hasSelection()) {
      options.notifyError('Select the pixels to cut first.');
      return;
    }
    await copy(false);
    await editor.apply([{ op: 'clear', id: t.id, target: t.target }]);
  };

  /** An image on the system clipboard, when the browser lets us read it. */
  const readClipboardImage = async (): Promise<Blob | undefined> => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return await item.getType(type);
      }
    } catch {
      // Closed to this page, or empty.
    }
    return undefined;
  };

  /**
   * Pastes an image as a layer: the one a paste event carried, else the
   * last copy made here, else (for Edit > Paste, `ask`) the system
   * clipboard's, which the browser may ask the person to allow.
   */
  const paste = async (image?: Blob, ask = false) => {
    if (!editable()) return;
    const blob =
      image ?? clipboard ?? (ask ? await readClipboardImage() : undefined);
    if (!blob) {
      options.notifyInfo('There is no image to paste.');
      return;
    }
    const bytes = await blob.arrayBuffer();
    const camera = view.camera();
    const v = view.viewport();
    const center = {
      x: camera.x + v.w / 2 / camera.zoom,
      y: camera.y + v.h / 2 / camera.zoom,
    };
    // Into the view's middle, or the selection's when there is one.
    const sel = editor.selection().bounds;
    const at = sel ? { x: sel.x + sel.w / 2, y: sel.y + sel.h / 2 } : center;
    await placeImage(bytes, nextLayerName(editor.layers()), at);
  };

  const placeImage = async (
    bytes: ArrayBuffer,
    name: string,
    at?: { x: number; y: number }
  ) => {
    await editor.placeImage(bytes, name, at, active()?.id);
  };

  // ---- layers -------------------------------------------------------------

  const newLayer = (kind: NewLayer, name: string | null = null) =>
    editor.apply([newLayerOp(active(), kind, name)]);

  const newFill = (type: 'solid' | 'gradient') =>
    newLayer({
      type: 'fill',
      fill:
        type === 'solid'
          ? { type: 'solid', color: view.foreground() }
          : {
              type: 'gradient',
              gradient: twoColorGradient(view.foreground(), view.background()),
            },
      path: null,
      stroke: null,
    });

  const newAdjustment = (type: EditableAdjustment) =>
    newLayer({ type: 'adjustment', adjustment: defaultAdjustment(type) });

  const ids = () => chosen();

  /** Adds a mask to the active layer; painting then edits the mask. */
  const addMask = async (init: MaskInit) => {
    const row = active();
    if (!row) return;
    if (row.background) {
      options.notifyError('The Background layer cannot have a mask.');
      return;
    }
    if (row.hasMask) return;
    const result = await editor.apply([{ op: 'addMask', id: row.id, init }]);
    if (result && editor.active() === row.id) editor.setTarget('mask');
  };

  const filterOp = (filter: FilterSpec): Op[] => {
    const t = pixelTarget();
    return t ? [{ op: 'filter', id: t.id, target: t.target, filter }] : [];
  };

  const requirePixels = (): boolean => {
    const row = active();
    const target = editor.target();
    if (!row) return false;
    if (target === 'mask' ? !row.hasMask : row.kind !== 'pixel') {
      options.notifyError(
        `Rasterize "${row.name}" first: filters change pixels.`
      );
      return false;
    }
    return true;
  };

  // ---- exports ---------------------------------------------------------------

  const downloadPsd = async () => {
    const saved = await editor.enqueue(() => engine.save());
    if (!saved) return;
    const large = editor.summary().large;
    options.download(
      new Blob([saved.bytes], { type: 'image/vnd.adobe.photoshop' }),
      `${safeName(options.fileName())}.${large ? 'psb' : 'psd'}`
    );
  };

  const exportImage = async (format: 'png' | 'jpeg', layer?: number) => {
    const blob = await editor.enqueue(() =>
      format === 'png' ? engine.exportPng(layer) : engine.exportJpeg(90)
    );
    if (!blob) return;
    const row =
      layer === undefined
        ? undefined
        : editor.layers().find((r) => r.id === layer);
    options.download(
      blob,
      `${safeName(row?.name ?? options.fileName())}.${format === 'png' ? 'png' : 'jpg'}`
    );
  };

  // ---- the commands ------------------------------------------------------------

  const hasLayer = () => !!active();
  const run = {
    undo: () => void editor.undo(),
    redo: () => void editor.redo(),
    copy: () => void copy(false),
    copyMerged: () => void copy(true),
    cut: () => void cut(),
    /** Edit > Paste. */
    paste: () => void paste(undefined, true),
    layerViaCopy: () => {
      const row = active();
      if (row)
        void editor.apply([{ op: 'copyToLayer', id: row.id, cut: false }]);
    },
    layerViaCut: () => {
      const row = active();
      if (row)
        void editor.apply([{ op: 'copyToLayer', id: row.id, cut: true }]);
    },
    fillForeground: () => {
      const t = pixelTarget();
      if (t)
        void editor.apply([
          { op: 'fill', ...t, color: view.foreground(), opacity: 1 },
        ]);
    },
    fillBackground: () => {
      const t = pixelTarget();
      if (t)
        void editor.apply([
          { op: 'fill', ...t, color: view.background(), opacity: 1 },
        ]);
    },
    /** Delete: the selected pixels, else the chosen layers. */
    delete: () => {
      const t = pixelTarget();
      if (t && editor.hasSelection()) {
        void editor.apply([{ op: 'clear', id: t.id, target: t.target }]);
        return;
      }
      if (ids().length > 0) void editor.apply([{ op: 'delete', ids: ids() }]);
    },
    freeTransform: () => void tools.startFreeTransform(),
    flipLayer: (horizontal: boolean) => {
      if (ids().length > 0)
        void editor.apply([{ op: 'flip', ids: ids(), horizontal }]);
    },
    rotateLayer: (quarters: number) => {
      if (ids().length > 0)
        void editor.apply([{ op: 'rotate', ids: ids(), quarters }]);
    },
    newLayer: () => void newLayer({ type: 'pixel' }),
    newGroup: () => void newLayer({ type: 'group' }),
    newFill,
    newAdjustment,
    duplicate: () => {
      if (ids().length > 0)
        void editor.apply([{ op: 'duplicate', ids: ids() }]);
    },
    deleteLayers: () => {
      if (ids().length > 0) void editor.apply([{ op: 'delete', ids: ids() }]);
    },
    mergeDown: () => {
      const row = active();
      const op = row && mergeDownOp(editor.layers(), row.id);
      if (op) void editor.apply([op]);
    },
    mergeVisible: () => {
      const visible = editor.layers().filter((r) => r.shown && r.depth === 0);
      if (visible.length > 1)
        void editor.apply([{ op: 'merge', ids: visible.map((r) => r.id) }]);
    },
    flatten: () => void editor.apply([{ op: 'flatten' }]),
    rasterize: () => {
      if (ids().length > 0)
        void editor.apply([{ op: 'rasterize', ids: ids() }]);
    },
    group: () => {
      if (ids().length > 0)
        void editor.apply([{ op: 'group', ids: ids(), name: null }]);
    },
    ungroup: () => {
      const row = active();
      if (row?.kind === 'group')
        void editor.apply([{ op: 'ungroup', id: row.id }]);
    },
    clippingMask: () => {
      const row = active();
      const op = row && clippingOp(row);
      if (op) void editor.apply([op]);
    },
    addMask,
    deleteMask: (apply: boolean) => {
      const row = active();
      if (row?.hasMask) {
        editor.setTarget('pixels');
        void editor.apply([{ op: 'deleteMask', id: row.id, apply }]);
      }
    },
    toggleMask: () => {
      const row = active();
      if (row?.hasMask)
        void editor.apply([
          { op: 'setMask', id: row.id, disabled: !row.maskDisabled },
        ]);
    },
    selectAll: () => void editor.select({ type: 'all' }),
    deselect: () => void editor.select({ type: 'none' }),
    invertSelection: () => void editor.select({ type: 'invert' }),
    loadTransparency: () => {
      const row = active();
      if (row)
        void editor.select({
          type: 'layer',
          id: row.id,
          mask: editor.target() === 'mask',
        });
    },
    convertToRgb: () => void editor.convertToRgb(),
    rotateCanvas: (quarters: number) =>
      void editor.apply([{ op: 'rotateCanvas', quarters }]),
    flipCanvas: (horizontal: boolean) =>
      void editor.apply([{ op: 'flipCanvas', horizontal }]),
    cropToSelection: () => {
      const b = editor.selection().bounds;
      if (b) void editor.apply([{ op: 'crop', rect: b }]);
    },
    desaturate: () => {
      if (requirePixels()) void editor.apply(filterOp({ type: 'desaturate' }));
    },
    openFilter: (filter: FilterKind) => {
      if (requirePixels()) setDialog({ kind: 'filter', filter });
    },
    openAdjust: (type: EditableAdjustment) => {
      if (requirePixels())
        setDialog({ kind: 'adjust', adjustment: defaultAdjustment(type) });
    },
    openDialog: (d: EditorDialog) => setDialog(d),
    downloadPsd: () => void downloadPsd(),
    exportPng: () => void exportImage('png'),
    exportJpeg: () => void exportImage('jpeg'),
    exportLayer: () => {
      const row = active();
      if (row) void exportImage('png', row.id);
    },
    zoomIn: () => view.zoomStep(1),
    zoomOut: () => view.zoomStep(-1),
    zoomFit: () => view.zoomToFit(),
    zoom100: () => view.zoom100(),
    togglePixelGrid: () => view.setPixelGrid(!view.pixelGrid()),
    brushSmaller: () =>
      view.setBrush({ size: stepBrushSize(view.brush().size, -1) }),
    brushLarger: () =>
      view.setBrush({ size: stepBrushSize(view.brush().size, 1) }),
    brushSofter: () =>
      view.setBrush({
        hardness: Math.max(
          0,
          Math.round((view.brush().hardness - 0.25) * 4) / 4
        ),
      }),
    brushHarder: () =>
      view.setBrush({
        hardness: Math.min(
          1,
          Math.round((view.brush().hardness + 0.25) * 4) / 4
        ),
      }),
    swapColors: () => view.swapColors(),
    defaultColors: () => view.resetColors(),
  };

  return {
    run,
    dialog,
    closeDialog: () => {
      setDialog(undefined);
      options.onDialogClosed?.();
    },
    paste,
    placeImage,
    filterOp,
    available: {
      layer: hasLayer,
      pixels: () => {
        const row = active();
        return (
          !!row &&
          (editor.target() === 'mask' ? row.hasMask : row.kind === 'pixel')
        );
      },
      selection: () => editor.hasSelection(),
      mask: () => !!active()?.hasMask,
      group: () => active()?.kind === 'group',
      mergeDown: () => {
        const row = active();
        return !!row && !!mergeDownOp(editor.layers(), row.id);
      },
    },
  };
}

export type PsdCommands = ReturnType<typeof createPsdCommands>;
