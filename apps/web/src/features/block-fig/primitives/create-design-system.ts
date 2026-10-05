/**
 * The design system side of the editor: the selected layer's component,
 * variant, property, and style details, the file's styles and components,
 * and the actions the design panel's sections perform with them.
 *
 * Details are loaded again after every edit (the viewer's edit version),
 * so other people's changes show too.
 */

import type { FigEngine } from '@core/fig-engine/client';
import type {
  BindableField,
  CollectionInfo,
  DesignInfo,
  PropertyKind,
  StyleInfo,
} from '@core/fig-engine/design-types';
import type { ComponentInfo } from '@core/fig-engine/types';
import { createEffect, createSignal, on } from 'solid-js';
import type { DesignOp, PropertyInput, StyleKind } from '../core/design-system';
import type { FigEditor } from './create-fig-editor';
import type { FigViewer } from './create-fig-viewer';

export function createDesignSystem(options: {
  engine: FigEngine;
  viewer: FigViewer;
  editor: FigEditor;
}) {
  const { engine, viewer, editor } = options;
  const [info, setInfo] = createSignal<DesignInfo>();
  const [styles, setStyles] = createSignal<StyleInfo[]>([]);
  const [components, setComponents] = createSignal<ComponentInfo[]>([]);
  const [variables, setVariables] = createSignal<CollectionInfo[]>([]);

  let request = 0;
  /** Loads the details of the single selected layer (the latest wins). */
  const loadInfo = async (id: string | undefined) => {
    const mine = ++request;
    if (!id) {
      setInfo(undefined);
      return;
    }
    try {
      const next = await engine.designInfo(viewer.page(), id);
      if (mine === request) setInfo(next);
    } catch {
      if (mine === request) setInfo(undefined);
    }
  };
  createEffect(
    on([viewer.selected, viewer.editVersion], ([selected]) => {
      void loadInfo(selected.length === 1 ? selected[0].id : undefined);
    })
  );

  // Styles and components change only with edits.
  let listRequest = 0;
  const loadLists = async () => {
    const mine = ++listRequest;
    try {
      const [s, c, v] = await Promise.all([
        engine.styles(),
        engine.components(),
        engine.variables(),
      ]);
      if (mine !== listRequest) return;
      setStyles(s);
      setComponents(c);
      setVariables(v);
    } catch {
      // A file that fails to answer keeps the last lists.
    }
  };
  createEffect(on(viewer.editVersion, () => void loadLists()));

  const run = (...ops: DesignOp[]) => editor.apply(ops);
  const selectedId = () => viewer.selected()[0]?.id;
  const editable = () => editor.enabled();

  /** Selects a layer by id on its page (going there first). */
  const reveal = async (id: string, page: number | null) => {
    if (page !== null && viewer.page() !== page) await viewer.openPage(page);
    await viewer.selectIds([id]);
    viewer.zoomToSelection();
  };

  return {
    info,
    styles,
    variables,
    components,
    editable,
    reveal,
    // ---- instances --------------------------------------------------------
    setProperty: (id: string, property: string, value: PropertyInput) =>
      run({ op: 'setProperty', ids: [id], property, value }),
    resetInstance: (id: string, property?: string) =>
      run({ op: 'resetInstance', ids: [id], property }),
    swapInstance: (id: string, component: string) =>
      run({ op: 'swapInstance', ids: [id], component }),
    detach: (id: string) => editor.apply([{ op: 'detach', ids: [id] }]),
    // ---- main components and variants -----------------------------------
    combineAsVariants: async (ids: string[]) => {
      const result = await run({ op: 'combineAsVariants', ids });
      if (result && result.created.length > 0)
        await viewer.selectIds(result.created);
    },
    addVariant: async (set: string, from?: string) => {
      const result = await run({ op: 'addVariant', set, from });
      if (result && result.created.length > 0)
        await viewer.selectIds(result.created);
    },
    /** "Add variant" on a lone component: it becomes a set of two. */
    makeVariants: async (component: string) => {
      const combined = await run({ op: 'combineAsVariants', ids: [component] });
      const set = combined?.created[0];
      if (!set) return;
      const result = await run({ op: 'addVariant', set });
      if (result && result.created.length > 0)
        await viewer.selectIds(result.created);
    },
    addVariantProperty: (set: string, name: string, value: string) =>
      run({ op: 'addVariantProperty', set, name, value }),
    renameVariantProperty: (set: string, from: string, to: string) =>
      run({ op: 'renameVariantProperty', set, from, to }),
    removeVariantProperty: (set: string, name: string) =>
      run({ op: 'removeVariantProperty', set, name }),
    setVariantValue: (id: string, property: string, value: string) =>
      run({ op: 'setVariantValue', ids: [id], property, value }),
    addComponentProperty: (
      component: string,
      name: string,
      kind: PropertyKind | 'VARIANT',
      value?: PropertyInput,
      layer?: string
    ) =>
      run({
        op: 'addComponentProperty',
        component,
        name,
        kind,
        value,
        layer,
      }),
    editComponentProperty: (
      component: string,
      property: string,
      change: { name?: string; value?: PropertyInput }
    ) => run({ op: 'editComponentProperty', component, property, ...change }),
    deleteComponentProperty: (component: string, property: string) =>
      run({ op: 'deleteComponentProperty', component, property }),
    bindProperty: (id: string, field: BindableField, property?: string) =>
      run({ op: 'bindProperty', ids: [id], field, property }),
    exposeInstance: (id: string, exposed: boolean) =>
      run({ op: 'exposeInstance', ids: [id], exposed }),
    // ---- styles ---------------------------------------------------------------
    /** Applies a style to the selection, or detaches it (no `style`). */
    applyStyle: (kind: StyleKind, style?: string) => {
      const ids = viewer.selected().map((s) => s.id);
      if (ids.length === 0) return Promise.resolve(undefined);
      return run({ op: 'applyStyle', ids, kind, style });
    },
    /** Makes a style from the selected layer's values and applies it. */
    createStyle: (kind: StyleKind, name: string) => {
      const from = selectedId();
      if (!from) return Promise.resolve(undefined);
      return run({ op: 'createStyle', kind, name, from });
    },
    editStyle: (
      style: string,
      change: { name?: string; props?: Record<string, unknown> },
      coalesce?: string
    ) => editor.apply([{ op: 'editStyle', style, ...change }], coalesce),
    deleteStyle: (style: string) => run({ op: 'deleteStyle', ids: [style] }),
    // ---- variables ------------------------------------------------------------
    /** Binds the selection's first fill or stroke to a color variable. */
    bindVariable: (field: 'FILL' | 'STROKE', variable?: string) => {
      const ids = viewer.selected().map((s) => s.id);
      if (ids.length === 0) return Promise.resolve(undefined);
      return run({ op: 'bindVariable', ids, field, index: 0, variable });
    },
    /** The selected frames' mode of a collection (none: inherited). */
    setVariableMode: (collection: string, mode?: string) => {
      const ids = viewer.selected().map((s) => s.id);
      if (ids.length === 0) return Promise.resolve(undefined);
      return run({ op: 'setVariableMode', ids, collection, mode });
    },
  };
}

export type DesignSystem = ReturnType<typeof createDesignSystem>;
