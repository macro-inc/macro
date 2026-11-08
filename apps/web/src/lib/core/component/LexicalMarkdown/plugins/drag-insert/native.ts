import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { fireAndForget } from '../../../../util/fireAndForget';
import { ownsNativeBlockDrag } from '../draggable-block/native';
import { nativeList } from '../draggable-block/nativeGeometry';

export type NativeInsertPoint = {
  key: number;
  position: 'before' | 'after';
  domRect: DOMRect;
};
/** Source hit testing for block boundaries and file insertion within list items. */
export function calculateNativeInsertPoint(
  view: EditorView,
  event: { clientX: number; clientY: number },
  padding = 0,
  intoListItems = false
): NativeInsertPoint | null {
  const editor = view.root.getBoundingClientRect();
  if (
    event.clientX < editor.left - padding ||
    event.clientX > editor.right + padding
  )
    return null;
  const children = view.node(0)?.children ?? [];
  const firstKey = children.at(0);
  const lastKey = children.at(-1);
  const firstRect =
    firstKey === undefined
      ? undefined
      : view.getElementByKey(firstKey)?.getBoundingClientRect();
  const lastRect =
    lastKey === undefined
      ? undefined
      : view.getElementByKey(lastKey)?.getBoundingClientRect();
  if (firstKey !== undefined && firstRect && event.clientY < firstRect.top)
    return { key: firstKey, position: 'before', domRect: firstRect };
  if (lastKey !== undefined && lastRect && event.clientY > lastRect.bottom)
    return { key: lastKey, position: 'after', domRect: lastRect };
  for (const [index, key] of children.entries()) {
    const element = view.getElementByKey(key);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (
      event.clientY < rect.top - padding ||
      event.clientY > rect.bottom + padding
    )
      continue;
    const node = view.node(key);
    if (intoListItems && nativeList(node)) {
      const items: number[] = [];
      const pending = [key];
      while (pending.length) {
        const key = pending.pop();
        if (key === undefined) break;
        const node = view.node(key);
        if (!node) continue;
        const first = node.children.at(0);
        if (
          node.type === 'listitem' &&
          (first === undefined || !nativeList(view.node(first)))
        )
          items.push(key);
        pending.push(...[...node.children].reverse());
      }
      const itemIndex = items.findIndex(
        (key) =>
          event.clientY <=
          (view.getElementByKey(key)?.getBoundingClientRect().bottom ??
            -Infinity)
      );
      const item = items.at(itemIndex);
      const itemRect =
        item === undefined
          ? undefined
          : view.getElementByKey(item)?.getBoundingClientRect();
      const target =
        itemIndex < 0
          ? undefined
          : itemRect && event.clientY >= itemRect.top + itemRect.height * 0.5
            ? item
            : itemIndex > 0
              ? items.at(itemIndex - 1)
              : undefined;
      const targetRect =
        target === undefined
          ? undefined
          : view.getElementByKey(target)?.getBoundingClientRect();
      if (target !== undefined && targetRect)
        return { key: target, position: 'after', domRect: targetRect };
    }
    if (event.clientY < rect.top + rect.height * 0.5) {
      const previous = children.at(index - 1);
      const previousRect =
        index > 0 && previous !== undefined
          ? view.getElementByKey(previous)?.getBoundingClientRect()
          : undefined;
      if (previous !== undefined && previousRect)
        return { key: previous, position: 'after', domRect: previousRect };
      return { key, position: 'before', domRect: rect };
    }
    return { key, position: 'after', domRect: rect };
  }
  return null;
}

/** Transfer entries and insertion facts enter the priority bus in one paste call. */
export function registerNativeDragInsert(
  view: EditorView,
  onPoint: (point: NativeInsertPoint | null) => void,
  padding = 8
): () => void {
  const drops = new WeakMap<
    DataTransfer,
    { key: number; generation: number; before: boolean }
  >();
  const releaseFacts = view.clipboard.registerFacts((clipboard) => {
    const insertion = drops.get(clipboard);
    drops.delete(clipboard);
    return {
      entries: insertion
        ? [
            {
              mime: 'application/x-macro-drop',
              value: JSON.stringify(insertion),
            },
          ]
        : [],
      release() {},
    };
  });
  const over = (event: DragEvent) => {
    if (
      !view.ownsEvent(event.target, true) ||
      view.root.contentEditable !== 'true' ||
      (event.dataTransfer && ownsNativeBlockDrag(view, event.dataTransfer))
    )
      return;
    event.preventDefault();
    onPoint(
      calculateNativeInsertPoint(
        view,
        event,
        padding,
        event.dataTransfer?.types.includes('Files')
      )
    );
  };
  const drop = (event: DragEvent) => {
    if (
      !view.ownsEvent(event.target, true) ||
      (event.dataTransfer && ownsNativeBlockDrag(view, event.dataTransfer))
    )
      return;
    onPoint(null);
    if (view.root.contentEditable !== 'true' || !event.dataTransfer) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = calculateNativeInsertPoint(
      view,
      event,
      padding,
      event.dataTransfer.types.includes('Files')
    );
    const generation = view.mirror.keyGeneration;
    if (!point || generation === null) return;
    drops.set(event.dataTransfer, {
      key: point.key,
      generation,
      before: point.position === 'before',
    });
    fireAndForget(
      view.clipboard.paste(event.dataTransfer),
      'editor.drop.paste'
    );
  };
  const leave = () => onPoint(null);
  view.root.addEventListener('dragover', over, true);
  view.root.addEventListener('drop', drop, true);
  view.root.addEventListener('dragleave', leave);
  view.root.addEventListener('dragend', leave);
  return () => {
    releaseFacts();
    view.root.removeEventListener('dragover', over, true);
    view.root.removeEventListener('drop', drop, true);
    view.root.removeEventListener('dragleave', leave);
    view.root.removeEventListener('dragend', leave);
  };
}
