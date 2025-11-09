/**
 * @file Replace the Default Lexical CodeNode with a version that can be
 * synced via a single LoroText item
 */

import { ENABLE_SVG_PREVIEW } from '@core/constant/featureFlags';
import {
  $isCodeNode,
  CodeNode,
  PrismTokenizer,
  type SerializedCodeNode,
} from '@lexical/code';
import { $findMatchingParent } from '@lexical/utils';
import {
  $applyNodeReplacement,
  $createTextNode,
  type EditorConfig,
  type LexicalNode,
  type RangeSelection,
  type Spread,
} from 'lexical';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import { $applyPeerIdFromSerialized } from '../plugins/peerIdPlugin';

/**
 * Lexical default imported prism languages.
 * 'prismjs/components/prism-clike';
 * 'prismjs/components/prism-javascript';
 * 'prismjs/components/prism-markup';
 * 'prismjs/components/prism-markdown';
 * 'prismjs/components/prism-c';
 * 'prismjs/components/prism-css';
 * 'prismjs/components/prism-objectivec';
 * 'prismjs/components/prism-sql';
 * 'prismjs/components/prism-powershell';
 * 'prismjs/components/prism-python';
 * 'prismjs/components/prism-rust';
 * 'prismjs/components/prism-swift';
 * 'prismjs/components/prism-typescript';
 * 'prismjs/components/prism-java';
 * 'prismjs/components/prism-cpp'
 */

// Additional Languages here.
import 'prismjs/components/prism-json';
import {
  DEFAULT_LANGUAGE,
  getSupportedLanguageFromFileExtension,
  isNormalizedLanguage,
  isSupportedLanguage,
  type LanguageDefinition,
  LanguageDefinitions,
  normalizedLanguage,
  type SupportedLanguage,
  SupportedLanguages,
} from '@lexical-core/utils/languageSupport';

const VERSION = 2;

// NOTE: At one point we wanted to CRDT each code node as a single plain text
// container. This didn't quite work with selection and interior code-highlight
// nodes. BUT some documents will still have state saved in node.text.
export type SerializedCustomCodeNode = Spread<
  { text?: string; previewEnabled?: boolean },
  SerializedCodeNode
>;

// Re-export for backward compatibility
export {
  SupportedLanguages,
  type SupportedLanguage,
  DEFAULT_LANGUAGE,
  LanguageDefinitions,
  type LanguageDefinition,
  isSupportedLanguage,
  normalizedLanguage,
  isNormalizedLanguage,
  getSupportedLanguageFromFileExtension,
};

PrismTokenizer.defaultLanguage = DEFAULT_LANGUAGE;

export class CustomCodeNode extends CodeNode {
  __previewEnabled: boolean = false;

  static getType() {
    return 'custom-code';
  }

  constructor(language: string | null | undefined, key?: string) {
    let lang = language ?? DEFAULT_LANGUAGE;
    if (isSupportedLanguage(lang)) {
      lang = normalizedLanguage(lang);
    }
    super(lang, key);
  }

  static clone(node: CustomCodeNode) {
    const cloned = new CustomCodeNode(node.__language, node.__key);
    cloned.__previewEnabled = node.__previewEnabled;
    return cloned;
  }

  updateFromJSON(
    serializedNode: SerializedCustomCodeNode | SerializedCodeNode
  ): this {
    const node = super.updateFromJSON(serializedNode);
    if (serializedNode.type === 'custom-code') {
      const customSerialized = serializedNode as SerializedCustomCodeNode;
      node.setPreviewEnabled(customSerialized.previewEnabled ?? false);
      if (!hasSerializedChildren(serializedNode)) {
        const text = customSerialized.text;
        if (text !== undefined) {
          this.setCode(serializedNode.language, text);
        }
      }
    }
    return node;
  }

  static importJSON(serializedNode: SerializedCustomCodeNode) {
    if (serializedNode.version !== VERSION) {
      // Migrate v1 to v2.
      if ('code' in serializedNode && typeof serializedNode.code === 'string') {
        serializedNode.text = serializedNode.code;
      }
    }
    const node = $createCustomCodeNode().updateFromJSON(serializedNode);
    $applyPeerIdFromSerialized(node, serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedCustomCodeNode {
    return {
      ...super.exportJSON(),
      previewEnabled: this.__previewEnabled,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.className = config.theme?.code ?? '';
    if (ENABLE_SVG_PREVIEW && this.__previewEnabled) {
      element.classList.toggle('preview-mode', true);
      element.contentEditable = 'false';
    }
    return element;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    super.updateDOM(prevNode, dom, config);
    if (
      ENABLE_SVG_PREVIEW &&
      prevNode.__previewEnabled !== this.__previewEnabled
    ) {
      if (this.__previewEnabled) {
        dom.classList.toggle('preview-mode', true);
        dom.contentEditable = 'false';
      } else {
        dom.classList.toggle('preview-mode', false);
        dom.contentEditable = 'true';
      }
    }
    return false; // Don't recreate DOM element
  }

  getCode(): string {
    return this.getLatest().getTextContent();
  }

  setLanguage(language: string | null | undefined): this {
    const self = this.getWritable();

    // Disable preview mode if language doesn't support it
    if (
      ENABLE_SVG_PREVIEW &&
      self.__previewEnabled &&
      language?.toLowerCase() !== 'svg'
    ) {
      self.__previewEnabled = false;
      self.markDirty();
    }

    return super.setLanguage(language);
  }

  setCode(language: string | null | undefined, code: string): this {
    const self = this.getWritable();
    self.__language = language;

    // Disable preview mode if language doesn't support it
    if (
      ENABLE_SVG_PREVIEW &&
      self.__previewEnabled &&
      language?.toLowerCase() !== 'svg'
    ) {
      self.__previewEnabled = false;
      self.markDirty();
    }

    return self.splice(0, self.getChildrenSize(), [$createTextNode(code)]);
  }

  getPreviewEnabled(): boolean {
    return this.getLatest().__previewEnabled;
  }

  setPreviewEnabled(enabled: boolean): this {
    if (!ENABLE_SVG_PREVIEW) {
      return this;
    }
    const self = this.getWritable();
    self.__previewEnabled = enabled;
    self.markDirty();
    return self;
  }
}

export function $createCustomCodeNode(
  language?: string | null | undefined
): CustomCodeNode {
  return $applyNodeReplacement(
    new CustomCodeNode(language ?? DEFAULT_LANGUAGE)
  );
}

export function $isCustomCodeNode(
  node: LexicalNode | null
): node is CustomCodeNode {
  return node instanceof CustomCodeNode;
}

function hasSerializedChildren(node: any) {
  return (
    'children' in node &&
    Array.isArray(node.children) &&
    node.children.length > 0
  );
}

export function $isChildOfCode(node: LexicalNode) {
  const parent = $findMatchingParent(node, (node) => {
    return $isCodeNode(node) || $isCustomCodeNode(node);
  });
  return Boolean(parent);
}

export function $isSelectionInsideCode(selection: RangeSelection) {
  return (
    $isChildOfCode(selection.focus.getNode()) ||
    $isChildOfCode(selection.anchor.getNode())
  );
}
