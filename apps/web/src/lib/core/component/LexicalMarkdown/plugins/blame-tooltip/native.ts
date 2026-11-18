import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { NodeKey } from '@macro-inc/lexical-wasm-view/view/types';
import type { BlameTooltipState } from './blameTooltipPlugin';

interface SerializedNode {
  readonly $?: { readonly id?: unknown };
  readonly children?: readonly SerializedNode[];
}

/**
 * Stable ids by node key. The view mirror carries no node state, so the map
 * is rebuilt from the serialized model when the document revision changes.
 */
function createNodeIds(view: EditorView) {
  let revision = -1;
  let ids = new Map<NodeKey, string>();
  const collect = (json: SerializedNode, key: NodeKey) => {
    const node = view.node(key);
    if (!node) return;
    const id = json.$?.id;
    if (typeof id === 'string') ids.set(key, id);
    json.children?.forEach((child, index) => {
      const childKey = node.children[index];
      if (childKey !== undefined) collect(child, childKey);
    });
  };
  return (key: NodeKey) => {
    if (revision !== view.documentRevision) {
      revision = view.documentRevision;
      ids = new Map();
      const state: { root: SerializedNode } = JSON.parse(
        view.query.serializedState()
      );
      collect(state.root, 0);
    }
    return ids.get(key);
  };
}

/**
 * Source blameTooltipPlugin over a native view: the hovered text node's
 * nearest stable id, suppressed on touch and while text is selected.
 */
export function registerNativeBlameTooltip(
  view: EditorView,
  setState: (state: Partial<BlameTooltipState>) => void
) {
  const nodeId = createNodeIds(view);
  const resolve = (target: HTMLElement): string | null => {
    let key = view.keyFromDOM(target);
    if (key === null || view.node(key)?.kind !== 'text') return null;
    while (key !== null) {
      const id = nodeId(key);
      if (id) return id;
      key = view.node(key)?.parent ?? null;
    }
    return null;
  };
  const dismiss = () => setState({ hovering: false, nodeId: null });
  const onPointerMove = (event: PointerEvent) => {
    if (isTouchDevice()) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return dismiss();
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().length > 0)
      return dismiss();
    const id = resolve(target);
    if (id === null) return dismiss();
    setState({
      hovering: true,
      x: event.clientX,
      y: event.clientY,
      nodeId: id,
    });
  };
  const root = view.root;
  document.addEventListener('scroll', dismiss, true);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerleave', dismiss);
  root.addEventListener('pointerdown', dismiss);
  root.addEventListener('beforeinput', dismiss);
  return () => {
    document.removeEventListener('scroll', dismiss, true);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerleave', dismiss);
    root.removeEventListener('pointerdown', dismiss);
    root.removeEventListener('beforeinput', dismiss);
  };
}
