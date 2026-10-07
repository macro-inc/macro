/**
 * Handoff around the editor: exporting the selection with its presets
 * (one file or a ZIP), "Export frames to PDF", storing presets and layout
 * grids on layers, the export preview, and Dev Mode's assets (the
 * selection and the layers inside it with presets).
 */

import type { FigEngine } from '@core/fig-engine/client';
import type {
  Exportable,
  ExportSetting,
  LayoutGridInfo,
} from '@core/fig-engine/handoff-types';
import type { NodeInfo } from '@core/fig-engine/types';
import { createEffect, createSignal, on } from 'solid-js';
import type { FigViewerContext } from '../context/fig-viewer-context';
import { defaultSetting } from '../core/export-settings';
import { gridSpec } from '../core/handoff-ops';
import type { FigEditor } from './create-fig-editor';
import type { FigViewer } from './create-fig-viewer';

/** The preview's longest side, in pixels. */
const PREVIEW_SIDE = 480;

export function createHandoff(options: {
  context: FigViewerContext;
  engine: FigEngine;
  viewer: FigViewer;
  editor: FigEditor;
  /** The single selected layer's properties. */
  info: () => NodeInfo | undefined;
  /** Dev Mode (the Code tab) is showing. */
  devMode: () => boolean;
}) {
  const { context, engine, viewer, editor } = options;

  const fail = (e: unknown, fallback: string) =>
    context.notifyError(e instanceof Error ? e.message : fallback);

  /**
   * Exports the selection: with `settings` (every selected layer), or each
   * layer's own presets, 1x PNG for layers without any.
   */
  const exportSelection = async (settings?: ExportSetting[]) => {
    const selected = viewer.selected().map((s) => s.id);
    if (selected.length === 0) {
      context.notifyInfo('Select a layer to export');
      return;
    }
    try {
      let items = selected.map((id) => ({
        id,
        settings: settings ?? null,
      }));
      if (!settings) {
        // Layers without presets export at 1x, as Figma's ⇧⌘E does.
        const own = await Promise.all(
          selected.map((id) => engine.nodeInfo(viewer.page(), id))
        );
        items = own.map((i) => ({
          id: i.id,
          settings: i.exportSettings.length ? null : [defaultSetting()],
        }));
      }
      const file = await engine.exportFiles(viewer.page(), {
        items,
        zipName: context.fileName(),
      });
      context.download(file.blob, file.name);
    } catch (e) {
      fail(e, 'Export failed');
    }
  };

  /** One layer with one preset (a Dev Mode asset). */
  const downloadAsset = async (id: string, setting: ExportSetting) => {
    try {
      const file = await engine.exportFiles(viewer.page(), {
        items: [{ id, settings: [setting] }],
      });
      context.download(file.blob, file.name);
    } catch (e) {
      fail(e, 'Export failed');
    }
  };

  /** "Export frames to PDF": the page's top-level frames, a page each. */
  const exportFramesPdf = async () => {
    try {
      const pdf = await engine.exportFramesPdf(viewer.page());
      const page = viewer.pages[viewer.page()]?.name ?? 'Page';
      context.download(pdf, `${context.fileName()} - ${page}.pdf`);
    } catch (e) {
      fail(e, 'Export failed');
    }
  };

  /** Stores presets on the selected layers. */
  const setExports = (settings: ExportSetting[]) => {
    const ids = editor.editableIds();
    if (ids.length === 0) return;
    void editor.apply([{ op: 'setExports', ids, settings }]);
  };

  // A drag (a color, a scrubbed value) is one undo step.
  let gridGesture: string | undefined;
  let gestures = 0;
  /** Replaces the selected frame's layout grids. */
  const setGrids = (grids: LayoutGridInfo[], live: boolean) => {
    const id = options.info()?.id;
    if (!id || id.startsWith('I')) return;
    if (live && !gridGesture) gridGesture = `layout-grids-${++gestures}`;
    const key = gridGesture;
    if (!live) gridGesture = undefined;
    void editor.apply(
      [{ op: 'setLayoutGrids', ids: [id], grids: grids.map(gridSpec) }],
      key
    );
  };

  /** A PNG of the selected layer for the preview (an object URL). */
  const preview = async (): Promise<string | undefined> => {
    const info = options.info();
    if (!info) return undefined;
    const side = Math.max(info.bounds.w, info.bounds.h, 1);
    const scale = Math.min(2, PREVIEW_SIDE / side);
    try {
      const png = await engine.exportPng(viewer.page(), info.id, scale);
      return URL.createObjectURL(png);
    } catch {
      return undefined;
    }
  };

  const [assets, setAssets] = createSignal<Exportable[]>([]);
  let request = 0;
  const loadAssets = async (id: string) => {
    const mine = ++request;
    try {
      const list = await engine.exportables(viewer.page(), id);
      if (mine === request) setAssets(list);
    } catch {
      if (mine === request) setAssets([]);
    }
  };
  // Dev Mode reads the engine (an external system) after every edit.
  createEffect(
    on([options.devMode, viewer.selected, viewer.editVersion], ([dev, sel]) => {
      if (!dev || sel.length !== 1) {
        ++request;
        setAssets([]);
        return;
      }
      void loadAssets(sel[0].id);
    })
  );

  return {
    exportSelection,
    exportFramesPdf,
    downloadAsset,
    setExports,
    setGrids,
    preview,
    assets,
  };
}

export type Handoff = ReturnType<typeof createHandoff>;
