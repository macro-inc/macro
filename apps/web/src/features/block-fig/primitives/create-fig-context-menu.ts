/**
 * Right-click menus on the canvas and the layers panel, as Figma has them.
 * A right-click selects what is under the pointer first (keeping a
 * selection it falls inside), then opens the layer menu, or the canvas
 * menu on empty canvas.
 */

import type { FigEngine } from '@core/fig-engine/client';
import { createSignal } from 'solid-js';
import { type Point, screenToPage } from '../core/camera';
import {
  canvasMenu,
  layerMenu,
  type MenuAction,
  type MenuEntry,
  type SelectionFacts,
} from '../core/context-menu';
import type { ViewerAction } from '../core/shortcuts';
import type { FigEditor } from './create-fig-editor';
import type { FigViewer } from './create-fig-viewer';

interface OpenMenu {
  /** Client coordinates of the right-click. */
  at: Point;
  /** The page point under it (where "Paste here" pastes). */
  page: Point;
  entries: MenuEntry[];
  facts?: SelectionFacts;
}

/** Targets that keep the browser's own menu, or none at all. */
const NATIVE = 'input, textarea, [contenteditable="true"]';
const NO_MENU = '[data-testid="fig-toolbar"], [role="dialog"]';

export function createFigContextMenu(options: {
  viewer: FigViewer;
  engine: FigEngine;
  editor: FigEditor;
  mac: boolean;
  /** Runs a shortcut action. */
  run: (action: ViewerAction) => void;
  /** Gives the viewer keyboard focus back. */
  focus: () => void;
}) {
  const { viewer, engine, editor } = options;
  const [menu, setMenu] = createSignal<OpenMenu>();
  let opening = 0;

  const selectionFacts = async (): Promise<SelectionFacts> => {
    const ids = viewer.selected().map((s) => s.id);
    const page = viewer.page();
    const [rows, info] = await Promise.all([
      engine.rows(page, ids).catch(() => []),
      ids.length === 1
        ? engine.nodeInfo(page, ids[0]).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    return {
      count: ids.length,
      canEdit: editor.enabled(),
      structural: editor.editableIds().length > 0,
      canPaste: editor.canPaste(),
      anyVisible: rows.some((r) => r.visible),
      anyUnlocked: rows.some((r) => !r.locked),
      types: [...new Set(rows.map((r) => r.type))],
      hasAutoLayout: !!info?.autoLayout,
    };
  };

  const show = async (e: MouseEvent, request: number) => {
    const facts =
      viewer.selected().length > 0 ? await selectionFacts() : undefined;
    if (request !== opening) return;
    const at = { x: e.clientX, y: e.clientY };
    const canvas = document
      .querySelector('[data-testid="fig-canvas"]')
      ?.getBoundingClientRect();
    const page = screenToPage(viewer.camera(), {
      x: at.x - (canvas?.left ?? 0),
      y: at.y - (canvas?.top ?? 0),
    });
    const entries = facts
      ? layerMenu(facts)
      : canvasMenu({
          canEdit: editor.enabled(),
          canPaste: editor.canPaste(),
          uiHidden: viewer.uiHidden(),
          rulers: viewer.rulers(),
          pixelGrid: viewer.pixelGrid(),
          outline: viewer.outlineView(),
        });
    setMenu({ at, page, entries, facts });
  };

  /** Selects what was right-clicked on the canvas, then opens the menu. */
  const openOnCanvas = async (e: MouseEvent, canvas: HTMLElement) => {
    const request = ++opening;
    const r = canvas.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    await viewer.pressAt(p, {
      deep: options.mac ? e.metaKey : e.ctrlKey,
      additive: false,
    });
    await show(e, request);
  };

  /** A right-click in the canvas area. */
  const onCanvas = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(NATIVE)) return;
    e.preventDefault();
    if (target.closest(NO_MENU)) return;
    const canvas = target.closest<HTMLElement>('[data-testid="fig-canvas"]');
    if (canvas) void openOnCanvas(e, canvas);
  };

  /** Selects a right-clicked row (unless selected), then opens the menu. */
  const openOnRow = async (e: MouseEvent, id: string) => {
    const request = ++opening;
    if (!viewer.selected().some((s) => s.id === id))
      await viewer.selectIds([id]);
    await show(e, request);
  };

  /** A right-click on a row of the layers panel. */
  const onLayers = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(NATIVE)) return;
    const id = target.closest<HTMLElement>('[data-layer-id]')?.dataset.layerId;
    if (!id) return;
    e.preventDefault();
    void openOnRow(e, id);
  };

  /** "Combine as variants": the selected components become a set. */
  const combineAsVariants = async () => {
    const result = await editor.apply([
      { op: 'combineAsVariants', ids: editor.editableIds() },
    ]);
    if (result && result.created.length > 0)
      await viewer.selectIds(result.created);
  };

  const choose = (action: MenuAction) => {
    const open = menu();
    setMenu(undefined);
    if (action !== 'rename') options.focus();
    if (action === 'paste-here') {
      if (open) void editor.pasteHere(open.page);
    } else if (action === 'paste-replace') {
      void editor.pasteToReplace();
    } else if (action === 'combine-as-variants') {
      void combineAsVariants();
    } else if (action === 'toggle-visible' && open?.facts) {
      // Several layers: hide them all unless all are hidden already.
      void editor.setProps({ visible: !open.facts.anyVisible });
    } else if (action === 'toggle-locked' && open?.facts) {
      void editor.toggleLocked();
    } else {
      options.run(action);
    }
  };

  return {
    menu,
    onCanvas,
    onLayers,
    choose,
    close: () => setMenu(undefined),
  };
}
