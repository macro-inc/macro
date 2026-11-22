import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';
import type { EditorThemeClasses } from 'lexical';
import { getOwner } from 'solid-js';
import {
  dispatchApplicationCommand,
  dispatchApplicationCommandIfSessionEdit,
  queryApplication,
} from '../plugins/group-b/command';
import type {
  DocumentCardHost,
  DocumentCardPreview,
} from './document-card-host';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeSelectionDecoratorContext } from './native-selection-host';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringRecord(value: unknown): value is Record<string, string> {
  return (
    record(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
function blockParams(value: unknown): Record<string, string> {
  if (!stringRecord(value))
    throw new Error('Invalid native card block parameters');
  return value;
}
export interface NativeDocumentCardContext
  extends NativeDecoratorContext<DocumentCardHost> {
  previewComponent(key: string): DocumentCardPreview | undefined;
  dispose(): void;
}
/** One actual view lease owns its preview registry and bulk durable-id lookup. */
export function createNativeDocumentCardContext(
  theme: EditorThemeClasses,
  options: {
    isInteractable(): boolean;
    readonly skipPreviewFetch?: boolean;
    layoutChanged?(): void;
  }
): NativeDocumentCardContext {
  const owner = getOwner();
  const selection = createNativeSelectionDecoratorContext(theme);
  let view: DecoratorProps['view'] | undefined;
  let generation: number | null = null;
  let alive = true;
  const previews = new Map<
    string,
    { component: DocumentCardPreview; dispose(): void }
  >();
  const releases = new Set<() => void>();
  const current = () =>
    alive && view?.isMounted && view.mirror.keyGeneration === generation
      ? view
      : undefined;
  function key(value: string) {
    const index = Number(value);
    const v = current();
    if (
      !v ||
      !Number.isSafeInteger(index) ||
      String(index) !== value ||
      !v.node(index) ||
      !v.getElementByKey(index)
    )
      return undefined;
    return index;
  }
  function owned(release: () => void) {
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      releases.delete(dispose);
      release();
    };
    releases.add(dispose);
    return dispose;
  }
  function edit(
    sourceKey: string,
    action:
      | 'remove'
      | 'to-mention'
      | 'preview-box'
      | 'preview-height'
      | 'preview-data'
      | 'block-params',
    data: Record<string, JsonValue> = {},
    after?: (handled: boolean) => void
  ) {
    const v = current();
    const index = key(sourceKey);
    if (!v || index === undefined) return;
    const payload = { key: index, action, ...data };
    if (
      action === 'preview-height' ||
      action === 'preview-data' ||
      action === 'preview-box'
    ) {
      dispatchApplicationCommandIfSessionEdit(
        v,
        'group-b.document-card',
        payload,
        after
      );
    } else
      dispatchApplicationCommand(
        v,
        'group-b.document-card',
        payload,
        undefined,
        after
      );
  }
  function nodeId(sourceKey: string) {
    const v = current();
    const index = key(sourceKey);
    if (!v || index === undefined) return;
    const id = queryApplication(v, 'group-b.document-card-id', { key: index });
    if (id === null || typeof id === 'string') return id;
    throw new Error('Invalid native card identity reply');
  }
  function clearPreview(id: string) {
    const preview = previews.get(id);
    if (!preview) return;
    previews.delete(id);
    preview.dispose();
  }
  return {
    theme,
    host: {
      available: () => !!current(),
      isSelected: selection.host.isSelected,
      isEditable: () => current()?.isEditable ?? false,
      isInteractable: () => !!current() && options.isInteractable(),
      get skipPreviewFetch() {
        return options.skipPreviewFetch ?? false;
      },
      get previewOwner() {
        return current()?.options.owner ?? owner;
      },
      layoutChanged: options.layoutChanged,
      registerEditableListener(listener) {
        const v = current();
        if (!v) throw new Error('Document decorator requires a live view');
        return owned(v.onEditableChange(listener));
      },
      select(sourceKey) {
        const v = current();
        const index = key(sourceKey);
        if (v && index !== undefined)
          v.port.selectionFromView({ kind: 'node', keys: [index] });
      },
      remove: (sourceKey) => edit(sourceKey, 'remove'),
      convertToMention: (sourceKey, selectEnd = false) =>
        edit(sourceKey, 'to-mention', { selectEnd }),
      setPreviewHeight(sourceKey, height) {
        edit(sourceKey, 'preview-height', { height }, (handled) => {
          if (handled && current()) options.layoutChanged?.();
        });
      },
      setCanvasLocation(sourceKey, location) {
        const v = current();
        const index = key(sourceKey);
        if (!v || index === undefined) return;
        const focused = v.root.ownerDocument.activeElement;
        const restoreFocus =
          focused instanceof HTMLElement &&
          v.getElementByKey(index)?.contains(focused);
        edit(sourceKey, 'preview-data', { data: { view: location } }, () => {
          if (
            current() &&
            restoreFocus &&
            focused instanceof HTMLElement &&
            focused.isConnected
          )
            focused.focus({ preventScroll: true });
        });
      },
      setPreviewBox: (sourceKey, box) =>
        edit(sourceKey, 'preview-box', { previewBox: box }),
      setBlockParams: (sourceKey, params) =>
        edit(sourceKey, 'block-params', { params }),
      observeBlockParams(sourceKey, listener) {
        const v = current();
        const index = key(sourceKey);
        if (!v || index === undefined)
          throw new Error('Card requires a live node');
        let previous: JsonValue | undefined;
        return owned(
          v.onCommit(() => {
            if (!current()) return;
            const node = v.node(index);
            if (node?.type !== 'document-card') return;
            const params = node.props().blockParams;
            if (params === previous) return;
            previous = params;
            listener(blockParams(params));
          })
        );
      },
      updateDocumentNames(names) {
        const v = current();
        if (v)
          dispatchApplicationCommandIfSessionEdit(v, 'group-b.document-names', {
            names,
          });
      },
      nodeId,
      cachePreview(id, component, dispose) {
        if (!alive) {
          dispose();
          return;
        }
        previews.set(id, { component, dispose });
      },
      clearPreview,
    },
    previewComponent(sourceKey) {
      const id = nodeId(sourceKey);
      return id ? previews.get(id)?.component : undefined;
    },
    bindView(incoming) {
      selection.bindView(incoming);
      view = incoming;
      generation = incoming.mirror.keyGeneration;
    },
    dispose() {
      if (!alive) return;
      alive = false;
      let failure: { error: unknown } | undefined;
      const cleanup = (call: () => void) => {
        try {
          call();
        } catch (error) {
          failure ??= { error };
        }
      };
      for (const release of [...releases]) cleanup(release);
      cleanup(selection.dispose);
      for (const id of [...previews.keys()]) cleanup(() => clearPreview(id));
      view = undefined;
      generation = null;
      if (failure) throw failure.error;
    },
  };
}
