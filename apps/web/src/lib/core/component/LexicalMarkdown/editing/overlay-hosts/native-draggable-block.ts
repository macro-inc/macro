import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { Accessor } from 'solid-js';
import {
  type NativeDragState,
  registerNativeDraggableBlock,
} from '../../plugins/draggable-block/native';
import { nativeList } from '../../plugins/draggable-block/nativeGeometry';
import type { DraggableBlockHost } from './draggable-block';

export function createNativeDraggableBlockHost(
  view: EditorView,
  canEdit: Accessor<boolean>,
  onState: (state: NativeDragState) => void
): DraggableBlockHost & { dispose(): void } {
  const registration = registerNativeDraggableBlock(view, onState, canEdit);
  let restorePreview: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearPreview = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    restorePreview?.();
    restorePreview = undefined;
  };
  return {
    root: () => view.root,
    start(event, element) {
      if (!element) return;
      registration.start(event, element, (selected) => {
        clearPreview();
        const transfer = event.dataTransfer;
        if (!transfer) return;
        const first = selected.at(0);
        if (first === undefined) return;
        const node = view.node(first);
        let image = view.getElementByKey(first);
        if (!image) return;
        const hidden: HTMLElement[] = [];
        const parent =
          node?.parent === null || node?.parent === undefined
            ? null
            : view.node(node.parent);
        if (
          node?.type === 'listitem' &&
          nativeList(parent) &&
          selected.length > 1
        ) {
          const parentDOM = parent && view.getElementByKey(parent.key);
          if (parentDOM) {
            image = parentDOM;
            for (const key of parent?.children ?? []) {
              if (selected.includes(key)) continue;
              const sibling = view.getElementByKey(key);
              if (sibling) hidden.push(sibling);
            }
          }
        }
        const preview = image;
        const transform = hidden.length ? '' : preview.style.transform;
        restorePreview = () => {
          for (const sibling of hidden) sibling.style.display = '';
          preview.style.transform = transform;
        };
        for (const sibling of hidden) sibling.style.display = 'none';
        preview.style.transform = 'translateZ(0)';
        try {
          transfer.setDragImage(preview, 0, 0);
          timer = setTimeout(clearPreview);
        } catch (error) {
          clearPreview();
          registration.end();
          throw error;
        }
      });
    },
    end() {
      clearPreview();
      registration.end();
    },
    dispose() {
      try {
        clearPreview();
      } finally {
        registration.dispose();
      }
    },
  };
}
