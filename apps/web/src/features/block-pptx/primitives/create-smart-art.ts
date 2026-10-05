/**
 * SmartArt state and actions for the editor: the selected diagram and node,
 * the text pane, the Choose a SmartArt Graphic dialog, gallery previews, and
 * every SmartArt edit (as PowerPoint's SmartArt Design tab and text pane
 * make them).
 */

import type {
  EditOp,
  EditResult,
  ShapeOutline,
  SlideOutline,
  SmartArtCatalog,
  SmartArtTarget as SmartArtConversion,
  SmartArtEdit,
  SmartArtOutline,
  SmartArtPosition,
  SmartArtPreviewPath,
  SmartArtPreviewSpec,
} from '@core/pptx-engine/types';
import { type Accessor, createSignal } from 'solid-js';
import { newNodeId, nodeAt } from '../core/smartart';

export interface SmartArtDeps {
  apply: (ops: EditOp[], group?: string) => Promise<EditResult | null>;
  slide: Accessor<SlideOutline | undefined>;
  /** The selected shapes. */
  selection: Accessor<ShapeOutline[]>;
  select: (id: number) => void;
  slideSize: Accessor<{ w: number; h: number }>;
  /** `[slot, '#RRGGBB']` theme colors, for previews in the deck's colors. */
  themeColors: Accessor<[string, string][]>;
  readonly: Accessor<boolean>;
  previews?: (
    specs: SmartArtPreviewSpec[]
  ) => Promise<(SmartArtPreviewPath[] | null)[]>;
  catalog?: () => Promise<SmartArtCatalog>;
}

/** A SmartArt graphic: the slide and shape ids edits address. */
export interface SmartArtTarget {
  slide: number;
  shape: number;
}

/** A gallery preview: `undefined` while it loads, `null` when unknown. */
export type PreviewState = SmartArtPreviewPath[] | null | undefined;

export function createSmartArt(deps: SmartArtDeps) {
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [paneOpen, setPaneOpen] = createSignal(false);
  /** The node picked on the stage or in the text pane. */
  const [activeNode, setActiveNodeRaw] = createSignal<string>();
  /** The node being typed into on the stage, and the text it starts with. */
  const [editing, setEditing] = createSignal<{ node: string; seed?: string }>();
  const [catalog, setCatalog] = createSignal<SmartArtCatalog>();
  /** Set when the pane is opened on request, so it takes the focus. */
  let paneFocus = false;
  const openPane = (open: boolean) => {
    paneFocus = open;
    setPaneOpen(open);
  };

  /** The SmartArt frame selected alone, if any. */
  const frame = (): ShapeOutline | undefined => {
    const list = deps.selection();
    return list.length === 1 && list[0].smartArt ? list[0] : undefined;
  };
  const outline = (): SmartArtOutline | undefined => frame()?.smartArt;
  /** The active node, when it still belongs to the selected diagram. */
  const activeNodeId = () => {
    const id = activeNode();
    return id && outline()?.nodes.some((n) => n.id === id) ? id : undefined;
  };
  const setActiveNode = (id: string | undefined) => {
    setActiveNodeRaw(id);
    if (editing()?.node !== id) setEditing(undefined);
  };

  // ---- catalog and previews -------------------------------------------------

  let catalogLoading = false;
  /** The galleries' catalog, loaded on first use. */
  const loadCatalog = () => {
    if (!catalogLoading && deps.catalog) {
      catalogLoading = true;
      void (async () => {
        try {
          setCatalog(await deps.catalog?.());
        } catch {
          catalogLoading = false;
        }
      })();
    }
    return catalog();
  };

  const previewCache = new Map<string, Accessor<PreviewState>>();
  /** A preview of `spec` in the deck's theme colors (cached). */
  const preview = (spec: SmartArtPreviewSpec): PreviewState => {
    const theme = Object.fromEntries(deps.themeColors());
    const key = JSON.stringify({ ...spec, theme });
    let state = previewCache.get(key);
    if (!state) {
      const [value, setValue] = createSignal<PreviewState>();
      state = value;
      previewCache.set(key, state);
      void (async () => {
        try {
          const [paths] = (await deps.previews?.([{ ...spec, theme }])) ?? [
            null,
          ];
          setValue(paths ?? null);
        } catch {
          setValue(null);
        }
      })();
    }
    return state();
  };

  // ---- edits ----------------------------------------------------------------

  /** The selected diagram, as edits address it. */
  const target = (): SmartArtTarget | undefined => {
    const s = deps.slide();
    const f = frame();
    return s && f ? { slide: s.id, shape: f.id } : undefined;
  };

  /** Applies a SmartArt edit to the selected diagram (or to `at`). */
  const edit = async (
    change: SmartArtEdit,
    group?: string,
    at: SmartArtTarget | undefined = target()
  ) => {
    if (!at || deps.readonly()) return null;
    return deps.apply(
      [{ op: 'editSmartArt', slide: at.slide, shape: at.shape, edit: change }],
      group
    );
  };

  /**
   * Sets a node's text (typing: one undo step per node and pause). Typing
   * captures `at` so text still lands after the graphic is deselected.
   */
  const setText = (node: string, text: string, at?: SmartArtTarget) =>
    edit(
      { action: 'setText', node, text },
      `smartart-text:${node}`,
      at ?? target()
    );

  /** Add Shape: a node `position`ed relative to the active node; returns its id. */
  const addNode = async (
    position: SmartArtPosition = 'after',
    text = '',
    node = activeNodeId()
  ) => {
    const before = outline();
    const result = await edit({
      action: 'addNode',
      ...(node ? { node, position } : {}),
      text,
    });
    if (!result) return undefined;
    const id = newNodeId(before, outline());
    if (id) setActiveNode(id);
    return id;
  };

  const nodeEdit =
    (action: 'promote' | 'demote' | 'moveUp' | 'moveDown' | 'deleteNode') =>
    (node = activeNodeId()) =>
      node ? edit({ action, node }) : Promise.resolve(null);

  /** Inserts a new SmartArt graphic (Insert ▸ SmartArt) at PowerPoint's default place. */
  const insert = async (layout: string) => {
    const s = deps.slide();
    if (!s || deps.readonly()) return undefined;
    const size = deps.slideSize();
    // PowerPoint's default: two thirds of the slide's width, 2:3, centered.
    const w = (size.w * 2) / 3;
    const h = Math.min(size.h * 0.79, (w * 2) / 3);
    const result = await deps.apply([
      {
        op: 'addShape',
        slide: s.id,
        shape: { kind: 'smartArt', layout },
        x: (size.w - w) / 2,
        y: (size.h - h) / 2,
        w,
        h,
      },
    ]);
    const id = result?.created[0]?.shape;
    if (id !== undefined) {
      deps.select(id);
      setActiveNode(undefined);
      openPane(true);
    }
    return id;
  };

  const convert = async (to: SmartArtConversion) => {
    const s = deps.slide();
    const f = frame();
    if (!s || !f || deps.readonly()) return;
    const result = await deps.apply([
      { op: 'convertSmartArt', slide: s.id, shape: f.id, to },
    ]);
    const id = result?.created[0]?.shape;
    setActiveNode(undefined);
    openPane(false);
    if (id !== undefined) deps.select(id);
  };

  /**
   * A click on the slide at `at` (points) on shape `hit`: picks the node
   * there when the diagram was already selected (PowerPoint's second click).
   * Returns whether a node was picked.
   */
  const pointerDown = (
    hit: ShapeOutline | undefined,
    at: { x: number; y: number }
  ): boolean => {
    const f = frame();
    if (!f || hit?.id !== f.id) {
      setActiveNode(undefined);
      return false;
    }
    const node = nodeAt(f, at);
    setActiveNode(node?.id);
    return !!node;
  };

  return {
    frame,
    target,
    outline,
    activeNode: activeNodeId,
    setActiveNode,
    editingNode: () => (activeNodeId() ? editing()?.node : undefined),
    /** The text the node editor starts with (its own text when unset). */
    editSeed: () => editing()?.seed,
    /**
     * Starts typing into a node on the stage (it becomes the active node);
     * `seed` replaces its text, as typing on a selected node does.
     */
    startEditing: (node: string, seed?: string) => {
      setActiveNodeRaw(node);
      setEditing({ node, seed });
    },
    stopEditing: () => setEditing(undefined),
    dialog: { open: dialogOpen, setOpen: setDialogOpen },
    pane: {
      open: () => paneOpen() && !!frame(),
      setOpen: openPane,
      toggle: () => openPane(!paneOpen()),
      /** Whether the pane was just opened on request (it takes focus once). */
      takeFocus: () => {
        const focus = paneFocus;
        paneFocus = false;
        return focus;
      },
    },
    catalog: loadCatalog,
    preview,
    insert,
    edit,
    setText,
    addNode,
    promote: nodeEdit('promote'),
    demote: nodeEdit('demote'),
    moveUp: nodeEdit('moveUp'),
    moveDown: nodeEdit('moveDown'),
    deleteNode: nodeEdit('deleteNode'),
    setLayout: (layout: string) => edit({ action: 'setLayout', layout }),
    setColors: (colors: string) => edit({ action: 'setColors', colors }),
    setStyle: (style: string) => edit({ action: 'setStyle', style }),
    reset: () => edit({ action: 'reset' }),
    convert,
    pointerDown,
  };
}

export type SmartArtState = ReturnType<typeof createSmartArt>;
