import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import type { Accessor } from 'solid-js';
import type { NativeTableKey } from '../../plugins/tables/nativeFacts';
import {
  captureNativeTableResize,
  nativeZoomLevel,
} from '../../plugins/tables/nativeResize';
import { createNativeListenerScope } from './native-listeners';
import { nativeTableCellFromTarget } from './native-table-dom';
import {
  type NativeTableEditOutcome,
  settleNativeTableEdit,
  tableEditPublished,
} from './native-table-edit';
import type {
  TableResizeDrag,
  TableResizeEdge,
  TableResizeHost,
} from './table-resize';

export type NativeTableResizeHit = {
  element: HTMLElement;
  key: NativeTableKey;
};

/** A native drag also reports when its queued inputs have all settled. */
export interface NativeTableResizeDrag extends TableResizeDrag {
  /** Resolves once no input is in flight or pending; never rejects. */
  settled(): Promise<void>;
  /** Every outcome this drag's inputs produced, in order. */
  outcomes(): readonly NativeTableEditOutcome[];
}

export type NativeTableResizeHost = Omit<
  TableResizeHost<NativeTableResizeHit>,
  'beginDrag'
> & {
  beginDrag(
    cell: NativeTableResizeHit,
    edge: TableResizeEdge,
    zoom: number
  ): NativeTableResizeDrag | undefined;
  /** Resolves once every drag's queued inputs have settled; never rejects. */
  settled(): Promise<void>;
  /** Drags the host still owns: those with queued or in-flight inputs. */
  ownedDrags(): number;
  dispose(): void;
};

/**
 * The native backend for the shared TableCellResizer. A gesture's snapshot
 * comes from one native query; its updates are SessionEdit inputs, at most
 * one in flight, coalesced to the latest delta. Merge and restore follow the
 * drag's own published evidence, never an attempt.
 */
export function createNativeTableResizeHost(
  view: EditorView,
  canEdit: Accessor<boolean>
): NativeTableResizeHost {
  const scope = createNativeListenerScope();
  let disposed = false;
  const drags = new Map<() => void, () => Promise<void>>();
  /** Own one registration; its cleanup runs at most once, inside the scope. */
  const register = (install: () => () => void) => {
    if (disposed) throw new Error('Table resize host is disposed');
    let cleanup: (() => void) | undefined;
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      cleanup?.();
    };
    scope.add(release);
    try {
      cleanup = install();
      return release;
    } catch (error) {
      disposed = true;
      return scope.fail(error);
    }
  };
  const editable = () =>
    !disposed &&
    view.isMounted &&
    canEdit() &&
    view.root.contentEditable === 'true';
  const current = (hit: NativeTableResizeHit) =>
    !disposed &&
    view.isMounted &&
    hit.key.generation === view.mirror.keyGeneration &&
    view.node(hit.key.index)?.type === 'tablecell';

  return {
    cellFromTarget(target) {
      const window = view.root.ownerDocument.defaultView;
      if (disposed || !view.isMounted || !window) return null;
      if (!(target instanceof window.Node)) return null;
      const element = nativeTableCellFromTarget(view, target);
      if (!element) return;
      const index = view.keyFromDOM(element);
      const generation = view.mirror.keyGeneration;
      if (
        index === null ||
        generation === null ||
        view.getElementByKey(index) !== element
      )
        return;
      return { element, key: { index, generation } };
    },
    isEditable: editable,
    zoom(cell) {
      return nativeZoomLevel(cell.element);
    },
    beginDrag(cell, edge, zoom) {
      if (!editable() || !current(cell)) return;
      const span =
        view.options.parentSpan?.span('editor.table.resize.capture') ??
        Telemetry.span('editor.table.resize.capture');
      let snapshot: ReturnType<typeof captureNativeTableResize>;
      try {
        span.setAttr('edge', edge);
        snapshot = span.run(() =>
          captureNativeTableResize(view, cell.element, edge, zoom)
        );
        span.setAttr('refused', snapshot === null);
      } catch (error) {
        span.error(error);
        throw error;
      } finally {
        span.end();
      }
      if (!snapshot) return;
      const drag = snapshot;
      let closed = false;
      /** At least one of this drag's own inputs published: merge and restore are owed. */
      let published = false;
      let pending: number | undefined;
      let restoreRequested = false;
      let inFlight: Promise<void> | undefined;
      const outcomes: NativeTableEditOutcome[] = [];
      const close = () => {
        drags.delete(close);
        closed = true;
        pending = undefined;
        restoreRequested = false;
      };
      const settledDrag = async () => {
        while (inFlight) await inFlight;
      };
      // Only a drag with queued or in-flight inputs is owned by the host, so a
      // finished gesture keeps nothing alive; the next input re-registers it.
      const track = () => {
        if (!closed) drags.set(close, settledDrag);
      };
      const releaseIfIdle = () => {
        if (!inFlight && pending === undefined && !restoreRequested)
          drags.delete(close);
      };
      /** Entry fence, read at each input's actual admission. */
      const admit = () =>
        !closed &&
        editable() &&
        view.mirror.keyGeneration === drag.generation &&
        view.node(drag.key) !== null;
      const pump = (): Promise<void> => {
        if (inFlight) return inFlight;
        if (closed || !admit()) {
          close();
          return Promise.resolve();
        }
        let next: Promise<NativeTableEditOutcome> | undefined;
        if (restoreRequested) {
          restoreRequested = false;
          if (published)
            next = settleNativeTableEdit(
              view,
              'restore',
              () => drag.restorePayload(),
              admit
            );
        } else if (pending !== undefined) {
          const delta = pending;
          const merge = published;
          pending = undefined;
          next = settleNativeTableEdit(
            view,
            'resize',
            () => drag.applyPayload(delta, merge),
            admit
          );
        }
        if (!next) {
          releaseIfIdle();
          return Promise.resolve();
        }
        const operation = next;
        inFlight = (async () => {
          const outcome = await operation;
          outcomes.push(outcome);
          if (tableEditPublished(outcome)) published = true;
          inFlight = undefined;
          await pump();
        })();
        return inFlight;
      };
      const result: NativeTableResizeDrag = {
        axis: drag.axis,
        apply(delta) {
          if (closed) return;
          pending = delta;
          track();
          fireAndForget(pump(), 'native-table-resize');
        },
        restore() {
          if (closed) return;
          pending = undefined;
          restoreRequested = true;
          track();
          fireAndForget(pump(), 'native-table-resize');
        },
        settled: settledDrag,
        outcomes: () => outcomes.slice(),
      };
      return result;
    },
    pinCell(cell) {
      return current(cell) && view.getElementByKey(cell.key.index)
        ? cell
        : undefined;
    },
    elementFor(cell) {
      if (!current(cell)) return;
      return view.getElementByKey(cell.key.index) ?? undefined;
    },
    registerRoot(listeners) {
      return register(() => {
        const root = view.root;
        root.addEventListener('pointermove', listeners.pointermove);
        root.addEventListener('pointerdown', listeners.pointerdown);
        return () => {
          root.removeEventListener('pointermove', listeners.pointermove);
          root.removeEventListener('pointerdown', listeners.pointerdown);
        };
      });
    },
    registerLayout(listener) {
      // Source: editor updates plus the editor root's width (registerEditorWidthObserver).
      let live = true;
      const notify = () => {
        if (live && !disposed) listener();
      };
      return register(() => {
        const window = view.root.ownerDocument.defaultView;
        if (!window)
          throw new Error('Table resize layout requires an owning window');
        const observer = new window.ResizeObserver(notify);
        let releaseCommit: (() => void) | undefined;
        const unwind = () => {
          live = false;
          let failure: { error: unknown } | undefined;
          try {
            releaseCommit?.();
          } catch (error) {
            failure = { error };
          }
          try {
            observer.disconnect();
          } catch (error) {
            failure ??= { error };
          }
          if (failure) throw failure.error;
        };
        try {
          releaseCommit = view.onCommit(notify);
          observer.observe(view.root);
        } catch (error) {
          try {
            unwind();
          } catch {
            // The installation failure stays the primary cause.
          }
          throw error;
        }
        return unwind;
      });
    },
    async settled() {
      await Promise.all([...drags.values()].map((settled) => settled()));
    },
    ownedDrags: () => drags.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const close of [...drags.keys()]) close();
      drags.clear();
      scope.dispose();
    },
  };
}
