/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { resetRandomKey } from '@upstream/LexicalUtils';
import {
  type CreateEditorArgs,
  createEditor,
  DecoratorNode,
  ElementNode,
  type LexicalEditor,
  type LexicalUpdateJSON,
  type SerializedElementNode,
  type SerializedLexicalNode,
} from 'lexical';
import { afterEach, beforeEach } from 'vitest';

type SerializedTestElementNode = SerializedElementNode;
type SerializedTestInlineElementNode = SerializedElementNode;
type SerializedTestDecoratorNode = SerializedLexicalNode & { block?: boolean };

export class TestElementNode extends ElementNode {
  static getType(): string {
    return 'test_block';
  }

  static clone(node: TestElementNode) {
    return new TestElementNode(node.__key);
  }

  static importJSON(
    serializedNode: SerializedTestElementNode
  ): TestInlineElementNode {
    return $createTestInlineElementNode().updateFromJSON(serializedNode);
  }

  createDOM() {
    return document.createElement('div');
  }

  updateDOM() {
    return false;
  }
}

export function $createTestElementNode(): TestElementNode {
  return new TestElementNode();
}

export class TestInlineElementNode extends ElementNode {
  static getType(): string {
    return 'test_inline_block';
  }

  static clone(node: TestInlineElementNode) {
    return new TestInlineElementNode(node.__key);
  }

  static importJSON(
    serializedNode: SerializedTestInlineElementNode
  ): TestInlineElementNode {
    return $createTestInlineElementNode().updateFromJSON(serializedNode);
  }

  createDOM() {
    return document.createElement('a');
  }

  updateDOM() {
    return false;
  }

  isInline() {
    return true;
  }

  canBeEmpty() {
    return false;
  }
}

export function $createTestInlineElementNode(): TestInlineElementNode {
  return new TestInlineElementNode();
}

export class TestDecoratorNode extends DecoratorNode<string> {
  __block: boolean = false;
  static getType(): string {
    return 'test_decorator';
  }

  static clone(node: TestDecoratorNode) {
    return new TestDecoratorNode(node.__key);
  }

  static importJSON(
    serializedNode: SerializedTestDecoratorNode
  ): TestDecoratorNode {
    return $createTestDecoratorNode().updateFromJSON(serializedNode);
  }

  static importDOM() {
    return {
      'test-decorator': (_domNode: HTMLElement) => {
        return {
          conversion: () => ({ node: $createTestDecoratorNode() }),
        };
      },
    };
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedTestDecoratorNode>
  ): this {
    return super
      .updateFromJSON(serializedNode)
      .setIsInline(!serializedNode.block);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__block = prevNode.__block;
  }

  isInline(): boolean {
    return !this.getLatest().__block;
  }

  setIsInline(inline: boolean): this {
    const self = this.getWritable();
    self.__block = !inline;
    return self;
  }

  exportJSON(): SerializedTestDecoratorNode {
    const json: SerializedTestDecoratorNode = super.exportJSON();
    if (this.__block) {
      json.block = this.__block;
    }
    return json;
  }

  exportDOM() {
    return {
      element: document.createElement('test-decorator'),
    };
  }

  getTextContent() {
    return 'Hello world';
  }

  createDOM() {
    return document.createElement(this.__block ? 'div' : 'span');
  }

  updateDOM(prevNode: this) {
    return this.__block !== prevNode.__block;
  }

  decorate() {
    return 'Hello world';
  }
}

export function $createTestDecoratorNode(): TestDecoratorNode {
  return new TestDecoratorNode();
}
type TestEnv = {
  editor: LexicalEditor;
  container: HTMLDivElement;
  innerHTML: string;
  outerHTML: string;
};
export function initializeUnitTest(
  run: (env: TestEnv) => void,
  config: CreateEditorArgs = { namespace: 'test', theme: {} }
): void {
  let current:
    | { editor: LexicalEditor; container: HTMLDivElement; root: HTMLDivElement }
    | undefined;
  const env: TestEnv = {
    get editor() {
      if (!current) throw new Error('not initialized');
      return current.editor;
    },
    get container() {
      if (!current) throw new Error('not initialized');
      return current.container;
    },
    get innerHTML() {
      return current?.root.innerHTML ?? '';
    },
    get outerHTML() {
      return current?.container.innerHTML ?? '';
    },
  };
  beforeEach(() => {
    resetRandomKey();
    const editor = createEditor({
      ...config,
      nodes: [
        TestElementNode,
        TestInlineElementNode,
        TestDecoratorNode,
        ...(config.nodes ?? []),
      ],
      onError(error) {
        throw error;
      },
    });
    const container = document.createElement('div');
    const root = document.createElement('div');
    root.contentEditable = 'true';
    container.append(root);
    document.body.append(container);
    editor.setRootElement(root);
    current = { editor, container, root };
  });
  afterEach(() => {
    current?.editor.setRootElement(null);
    current?.container.remove();
    current = undefined;
  });
  run(env);
}
