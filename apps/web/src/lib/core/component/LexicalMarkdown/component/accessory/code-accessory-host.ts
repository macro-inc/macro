import { ENABLE_SVG_PREVIEW } from '@core/constant/featureFlags';
import { $isCodeNode, CodeNode } from '@lexical/code';
import { $isCustomCodeNode } from '@macro-inc/lexical-core';
import { $getNodeByKey, type LexicalEditor, type NodeKey } from 'lexical';
import { type Accessor, createSignal } from 'solid-js';
import { deleteCodeNode } from '../../plugins/code/deleteCodeNode';
import { autoRegister } from '../../plugins/shared/utils';

/** The code-block accessory's editor seam; each editor engine supplies one per code node. */
export interface CodeAccessoryHost {
  /** Source reads editability once, when the accessory mounts. */
  readonly editableAtMount: boolean;
  language: Accessor<string>;
  previewEnabled: Accessor<boolean>;
  setPreviewEnabledLocally: (enabled: boolean) => void;
  setLanguage: (language: string) => void;
  setPreviewEnabled: (enabled: boolean) => void;
  deleteCode: () => void;
  codeText: () => string;
  root: () => HTMLElement | null;
  /** The code element now; a native view may replace it while the accessory stays mounted. */
  mountElement?: Accessor<HTMLElement | undefined>;
  observeMutations: (onMutation: () => void) => () => void;
}

/**
 * Engine-independent state, preserving Source defaults: the label starts at
 * 'JavaScript' and follows the node only while SVG preview is enabled.
 */
export function createCodeAccessoryState() {
  const [language, setLanguage] = createSignal('JavaScript');
  const [previewEnabled, setPreviewEnabled] = createSignal(false);
  return { language, setLanguage, previewEnabled, setPreviewEnabled };
}

/** Source engine: the existing CodeBoxAccessory editor reads and updates. */
export function createLexicalCodeAccessoryHost(
  editor: LexicalEditor,
  nodeKey: NodeKey,
  observeMutations: CodeAccessoryHost['observeMutations']
): CodeAccessoryHost {
  const state = createCodeAccessoryState();
  if (ENABLE_SVG_PREVIEW) {
    autoRegister(
      editor.registerMutationListener(
        CodeNode,
        (mutations) => {
          const match = mutations.get(nodeKey);
          if (match === 'created' || match === 'updated') {
            queueMicrotask(() =>
              editor.read(() => {
                const node = $getNodeByKey(nodeKey);
                if (!$isCodeNode(node)) return;
                state.setLanguage(node.getLanguage() ?? 'plain');
                if ($isCustomCodeNode(node)) {
                  state.setPreviewEnabled(node.getPreviewEnabled());
                }
              })
            );
          }
        },
        { skipInitialization: false }
      )
    );
  }
  return {
    editableAtMount: editor.isEditable(),
    language: state.language,
    previewEnabled: state.previewEnabled,
    setPreviewEnabledLocally: state.setPreviewEnabled,
    setLanguage(language) {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (!$isCustomCodeNode(node)) return;
        node.setLanguage(language);
        state.setPreviewEnabled(node.getPreviewEnabled());
      });
    },
    setPreviewEnabled(enabled) {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (!$isCustomCodeNode(node)) return;
        node.setPreviewEnabled(enabled);
      });
    },
    deleteCode: () => deleteCodeNode(editor, nodeKey),
    codeText: () =>
      editor.read(() => $getNodeByKey(nodeKey)?.getTextContent() ?? ''),
    root: () => editor.getRootElement(),
    observeMutations,
  };
}
