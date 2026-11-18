import { EditorView } from '@macro-inc/lexical-wasm-view';
import { readSelection } from '@macro-inc/lexical-wasm-view/view/selection';
import { Telemetry } from '@macro-inc/observability';
import { createNativeListenerScope } from '../../editing/overlay-hosts/native-listeners';
import { dispatchApplicationCommand } from '../group-b/command';
import { nativeBlockAtY, nativeDragGroup } from './nativeGeometry';

export type NativeDragState = {
  hoveredElement: HTMLElement | null;
  isDragging: boolean;
  targetElement: HTMLElement | null;
  targetPosition: 'before' | 'after' | null;
};
const MIME = 'application/x-lexical-drag-block';
let active: {
  view: EditorView;
  key: number;
  generation: number;
  revision: number;
  payload: string;
} | null = null;

/** Whether the current same-editor block transfer owns the drop path. */
export function ownsNativeBlockDrag(
  view: EditorView,
  transfer: DataTransfer
): boolean {
  return active?.view === view && transfer.types.includes(MIME);
}

/** DOM geometry and transfer ownership; every tree mutation is one native command. */
export function registerNativeDraggableBlock(
  view: EditorView,
  onState: (state: NativeDragState) => void,
  canEdit: () => boolean = () => true
) {
  const listeners = createNativeListenerScope();
  let disposed = false;
  let state: NativeDragState = {
    hoveredElement: null,
    isDragging: false,
    targetElement: null,
    targetPosition: null,
  };
  const update = (patch: Partial<NativeDragState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    onState(state);
  };
  const reset = () =>
    update({
      hoveredElement: null,
      isDragging: false,
      targetElement: null,
      targetPosition: null,
    });
  let frame: number | undefined;
  let latest: MouseEvent | undefined;
  const clearHover = () => {
    if (!state.isDragging) update({ hoveredElement: null });
  };
  const hover = (event: MouseEvent) => {
    latest = event;
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const event = latest;
      latest = undefined;
      if (!event || state.isDragging) return;
      if (!canEdit()) {
        clearHover();
        return;
      }
      if (!(event.target instanceof HTMLElement)) {
        clearHover();
        return;
      }
      if (event.buttons > 0) return;
      const selection = readSelection(view);
      if (
        selection.kind === 'range' &&
        (selection.anchor.key !== selection.focus.key ||
          selection.anchor.offset !== selection.focus.offset)
      ) {
        clearHover();
        return;
      }
      if (event.target.closest('.draggable-block-menu')) return;
      const owner = EditorView.fromDOM(event.target);
      if (owner && owner !== view) {
        clearHover();
        return;
      }
      const rect = view.root.getBoundingClientRect();
      if (
        event.clientX < rect.left - 60 ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        clearHover();
        return;
      }
      let parent = view.root.parentElement;
      while (
        parent &&
        !['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)
      )
        parent = parent.parentElement;
      const visible = parent?.getBoundingClientRect();
      if (
        visible &&
        (event.clientY < visible.top || event.clientY > visible.bottom)
      ) {
        clearHover();
        return;
      }
      const block = nativeBlockAtY(view, event.clientY);
      if (block && visible && block.getBoundingClientRect().top < visible.top) {
        clearHover();
        return;
      }
      update({ hoveredElement: block });
    });
  };
  const target = (event: DragEvent) => {
    const element = nativeBlockAtY(view, event.clientY, true);
    if (!element) return null;
    const key = view.keyFromDOM(element);
    if (key === null) return null;
    const rect = element.getBoundingClientRect();
    return { element, key, before: event.clientY < rect.top + rect.height / 2 };
  };
  const ours = (event: DragEvent) =>
    active?.view === view &&
    event.dataTransfer?.getData(MIME) === active.payload;
  const over = (event: DragEvent) => {
    if (
      !view.ownsEvent(event.target, true) ||
      active?.view !== view ||
      !event.dataTransfer?.types.includes(MIME)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!canEdit() || view.root.contentEditable !== 'true') {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      reset();
      return;
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const point = target(event);
    update({
      targetElement: point?.element ?? null,
      targetPosition: point ? (point.before ? 'before' : 'after') : null,
    });
  };
  const drop = (event: DragEvent) => {
    if (!view.ownsEvent(event.target, true) || !ours(event) || !active) return;
    const drag = active;
    active = null;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!canEdit() || view.root.contentEditable !== 'true') {
      reset();
      return;
    }
    const point = target(event);
    reset();
    if (
      !point ||
      view.mirror.keyGeneration !== drag.generation ||
      view.documentRevision !== drag.revision
    )
      return;
    const span = Telemetry.span('editor.block.move');
    try {
      span.run(() =>
        dispatchApplicationCommand(view, 'group-b.move', {
          action: 'move',
          source: drag.key,
          target: point.key,
          before: point.before,
        })
      );
    } finally {
      span.end();
    }
  };
  const end = () => {
    if (active?.view === view) active = null;
    reset();
  };
  const scroll = () => {
    if (!state.isDragging) update({ hoveredElement: null });
  };
  listeners.add(() => {
    disposed = true;
    if (active?.view === view) active = null;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    latest = undefined;
  });
  try {
    view.root.ownerDocument.addEventListener('mousemove', hover);
    listeners.add(() =>
      view.root.ownerDocument.removeEventListener('mousemove', hover)
    );
    view.root.addEventListener('keydown', clearHover);
    listeners.add(() => view.root.removeEventListener('keydown', clearHover));
    view.root.addEventListener('dragover', over, true);
    listeners.add(() => view.root.removeEventListener('dragover', over, true));
    view.root.addEventListener('drop', drop, true);
    listeners.add(() => view.root.removeEventListener('drop', drop, true));
    view.root.ownerDocument.addEventListener('dragend', end);
    listeners.add(() =>
      view.root.ownerDocument.removeEventListener('dragend', end)
    );
    view.root.ownerDocument.addEventListener('scroll', scroll, true);
    listeners.add(() =>
      view.root.ownerDocument.removeEventListener('scroll', scroll, true)
    );
  } catch (error) {
    listeners.fail(error);
  }
  return {
    /** The handle may live in a portal; its owner supplies the hovered element. */
    start(
      event: DragEvent,
      element: HTMLElement,
      preview?: (keys: readonly number[]) => void
    ): boolean {
      const key = view.keyFromDOM(element);
      if (
        disposed ||
        !canEdit() ||
        !view.isMounted ||
        view.root.contentEditable !== 'true' ||
        !view.ownsEvent(element, true) ||
        key === null ||
        !event.dataTransfer
      )
        return false;
      const keys = nativeDragGroup(view, key);
      const source = keys.at(0);
      const generation = view.mirror.keyGeneration;
      if (source === undefined || generation === null) return false;
      const payload = String(source);
      event.dataTransfer.effectAllowed = 'move';
      preview?.(keys);
      event.dataTransfer.setData(MIME, payload);
      active = {
        view,
        key: source,
        generation,
        revision: view.documentRevision,
        payload,
      };
      update({ isDragging: true });
      return true;
    },
    end,
    dispose: listeners.dispose,
  };
}
