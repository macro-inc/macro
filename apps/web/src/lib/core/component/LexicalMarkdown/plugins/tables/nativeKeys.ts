/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Table arrow geometry retargeted from Lexical 0.45.0,
 * 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { readSelection } from '@macro-inc/lexical-wasm-view/view/selection';
import { dispatchApplicationCommand } from '../group-b/command';

/** One key admission with DOM layout facts; all command priorities stay native. */
export function registerNativeTableKeys(view: EditorView): () => void {
  const window = view.root.ownerDocument.defaultView;
  if (!window) throw new Error('Table keys require a window');
  const pending = new Set<number>();
  let active = true;
  let keyEpoch = 0;
  const releaseCheck = view.onPluginEvent(
    'group-b.table-check-down',
    (payload) => {
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        !('tables' in payload) ||
        !('generation' in payload) ||
        !Array.isArray(payload.tables) ||
        typeof payload.generation !== 'number'
      )
        throw new Error('Invalid table selection check');
      const { generation } = payload;
      const tables: number[] = [];
      for (const key of payload.tables) {
        if (typeof key !== 'number') throw new Error('Invalid table check key');
        tables.push(key);
      }
      const epoch = keyEpoch;
      const revision = view.documentRevision;
      const frame = window.requestAnimationFrame(() => {
        pending.delete(frame);
        if (
          !active ||
          !view.isMounted ||
          epoch !== keyEpoch ||
          revision !== view.documentRevision ||
          !view.root.contains(view.root.ownerDocument.activeElement) ||
          !view.ownsEvent(view.root.ownerDocument.activeElement, true) ||
          view.root.contentEditable !== 'true' ||
          view.mirror.keyGeneration !== generation ||
          !tables.some((key) => view.node(key) !== null)
        )
          return;
        dispatchApplicationCommand(view, 'group-b.table-check-down', {
          tables,
        });
      });
      pending.add(frame);
    }
  );
  const releaseRoute = view.registerKeyRoute((event) => {
    keyEpoch++;
    if (
      event.isComposing ||
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(
        event.key
      )
    )
      return null;
    const cells: number[] = [];
    let hasTable = false;
    for (const node of view.mirror.values()) {
      if (node.type === 'table') hasTable = true;
      if (node.type === 'tablecell' && view.getElementByKey(node.key))
        cells.push(node.key);
    }
    if (!hasTable) return null;
    let caret: {
      key: number;
      offset: number;
      edge: number;
      up: boolean;
      exits: boolean;
    } | null = null;
    const cached = view.selection().selection;
    const selection =
      cached.kind === 'table' || cached.kind === 'node'
        ? cached
        : readSelection(view);
    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      selection.kind === 'range'
    ) {
      const anchor = selection.anchor;
      let cell = view.node(anchor.key);
      while (cell && cell.type !== 'tablecell')
        cell = cell.parent === null ? null : view.node(cell.parent);
      const anchorDOM = view.getElementByKey(anchor.key);
      const up = event.key === 'ArrowUp';
      const edge = up ? cell?.children.at(0) : cell?.children.at(-1);
      const edgeDOM = edge === undefined ? null : view.getElementByKey(edge);
      const domSelection = view.root.ownerDocument.getSelection();
      const rect =
        anchor.type === 'element'
          ? anchorDOM?.getBoundingClientRect()
          : domSelection?.rangeCount
            ? domSelection.getRangeAt(0).getBoundingClientRect()
            : undefined;
      if (edge !== undefined && edgeDOM && rect) {
        const edgeRect = edgeDOM.getBoundingClientRect();
        caret = {
          key: anchor.key,
          offset: anchor.offset,
          edge,
          up,
          exits: up
            ? edgeRect.top > rect.top - rect.height
            : rect.bottom + rect.height > edgeRect.bottom,
        };
      }
    }
    return {
      name: 'group-b.table-key',
      json: JSON.stringify({
        typeahead: view.root.getAttribute('aria-controls') === 'typeahead-menu',
        cells,
        caret,
      }),
      preventDefault: false,
    };
  });
  return () => {
    active = false;
    releaseRoute();
    releaseCheck();
    for (const frame of pending) window.cancelAnimationFrame(frame);
    pending.clear();
  };
}
