import { ENABLE_SVG_PREVIEW } from '@core/constant/featureFlags';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { createSignal, type Setter } from 'solid-js';
import { createStore } from 'solid-js/store';
import { CodeBoxAccessory } from '../../component/accessory/CodeBoxAccessory';
import {
  type CodeAccessoryHost,
  createCodeAccessoryState,
} from '../../component/accessory/code-accessory-host';
import type { AccessoryItem } from '../node-accessory';
import {
  deleteNativeCode,
  setNativeCodeLanguage,
  setNativeCodePreview,
} from './native';

const CODE_TYPE = 'custom-code';

/** CodeNode.getTextContent over the mirror: text leaves and '\n' line breaks. */
function codeText(view: EditorView, key: number): string {
  const node = view.node(key);
  if (!node) return '';
  if (node.kind === 'text') return node.text;
  if (node.kind === 'linebreak') return '\n';
  return node.children.map((child) => codeText(view, child)).join('');
}

function observeRootMutations(root: HTMLElement, onMutation: () => void) {
  const observer = new MutationObserver(onMutation);
  observer.observe(root, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  return () => observer.disconnect();
}

type NativeCodeAccessoryOptions = {
  /** Native initial accessories may mount before the editor is ready/editable. */
  ready: () => boolean;
};

/**
 * Native nodeAccessoryPlugin + CodeBoxAccessory host: one accessory per code
 * block, created on mount and merged on update without remounting, as Source.
 */
export function createNativeCodeAccessories(
  view: EditorView,
  options: NativeCodeAccessoryOptions
) {
  const [store, setStore] = createStore<Record<string, AccessoryItem>>({});
  const refreshers = new Map<number, () => void>();
  const editableAtMount = new Map<number, boolean>();
  const elements = new Map<
    number,
    [() => HTMLElement | undefined, Setter<HTMLElement | undefined>]
  >();

  const host = (key: number): CodeAccessoryHost => {
    const state = createCodeAccessoryState();
    const refresh = () => {
      const node = view.node(key);
      if (node?.type !== CODE_TYPE) return;
      const props = node.props();
      state.setLanguage(
        typeof props.language === 'string' ? props.language : 'plain'
      );
      state.setPreviewEnabled(props.previewEnabled === true);
    };
    if (ENABLE_SVG_PREVIEW) {
      refreshers.set(key, () => queueMicrotask(refresh));
      queueMicrotask(refresh);
    }
    return {
      editableAtMount: editableAtMount.get(key) ?? false,
      language: state.language,
      previewEnabled: state.previewEnabled,
      setPreviewEnabledLocally: state.setPreviewEnabled,
      setLanguage(language) {
        setNativeCodeLanguage(view, key, language);
      },
      setPreviewEnabled(enabled) {
        setNativeCodePreview(view, key, enabled);
      },
      deleteCode: () => deleteNativeCode(view, key),
      codeText: () => codeText(view, key),
      root: () => view.root,
      mountElement: elements.get(key)?.[0],
      observeMutations: (onMutation) =>
        observeRootMutations(view.root, onMutation),
    };
  };

  const mount = (key: number) => {
    const element = view.getElementByKey(key);
    if (!element) return;
    element.classList.add('__decorator-mount-ref');
    // A loaded block may mount before the editor is ready. Source opens an
    // editable document with editable headers (observed), so a false value is
    // read again on the next mount; a true value stays, as Source's host keeps
    // its editableAtMount.
    const wasEditable = editableAtMount.get(key) ?? false;
    const editable = wasEditable || (options.ready() && view.isEditable);
    editableAtMount.set(key, editable);
    const current = elements.get(key);
    if (current) current[1](element);
    else elements.set(key, createSignal<HTMLElement | undefined>(element));
    // A new host only renders through a fresh store entry (Source
    // FORCE_REFRESH_ACCESSORIES_COMMAND).
    if (editable !== wasEditable) setStore(String(key), undefined!);
    setStore(String(key), {
      key: String(key),
      mountRef: element,
      component: ({ ref }) =>
        CodeBoxAccessory({ floatRef: ref, host: host(key) }),
    });
  };

  for (const node of view.mirror.values())
    if (node.type === CODE_TYPE) mount(node.key);

  const release = view.onMutations(CODE_TYPE, (mutations) => {
    for (const [key, mutation] of mutations) {
      if (mutation === 'destroyed') {
        refreshers.delete(key);
        editableAtMount.delete(key);
        elements.delete(key);
        setStore(String(key), undefined!);
        continue;
      }
      mount(key);
      refreshers.get(key)?.();
    }
  });

  return {
    store,
    /** Remount the blocks mounted while the editor was not ready and editable. */
    refreshEditable() {
      for (const [key, editable] of editableAtMount) if (!editable) mount(key);
    },
    dispose() {
      release();
      refreshers.clear();
      editableAtMount.clear();
      elements.clear();
    },
  };
}

export type NativeCodeAccessories = ReturnType<
  typeof createNativeCodeAccessories
>;
