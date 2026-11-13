import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installIosSentenceCapitalization } from './iosSentenceCapitalization';

let restoreInstall = () => {};

function mount(text: string, format?: 'bold' | 'code') {
  const editor = createEditor({
    namespace: 'ios-sentence-capitalization-test',
    nodes: [ParagraphNode, TextNode],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  editor.update(
    () => {
      const node = $createTextNode(text);
      if (format) node.toggleFormat(format);
      $getRoot().clear().append($createParagraphNode().append(node));
    },
    { discrete: true }
  );
  return { editor, root };
}

function textChild(root: HTMLElement): Text {
  const found = root.querySelector('p')?.querySelector('*')?.firstChild;
  const nested = found instanceof HTMLElement ? found.firstChild : found;
  if (!(nested instanceof Text)) throw new Error('missing text node');
  return nested;
}

function spyOnValueAssignment(text: Text) {
  let writes = 0;
  const descriptor = Object.getOwnPropertyDescriptor(
    Node.prototype,
    'nodeValue'
  );
  if (!descriptor?.get || !descriptor.set) {
    throw new Error('Node.nodeValue is not a property');
  }
  Object.defineProperty(text, 'nodeValue', {
    configurable: true,
    get() {
      return descriptor.get!.call(this);
    },
    set(value: string) {
      writes++;
      descriptor.set!.call(this, value);
    },
  });
  return {
    writes: () => writes,
    insertData: vi.spyOn(text, 'insertData'),
  };
}

afterEach(() => {
  restoreInstall();
  restoreInstall = () => {};
  document.body.replaceChildren();
});

describe('installIosSentenceCapitalization', () => {
  test('inserts a typed character without replacing the text node value', () => {
    restoreInstall = installIosSentenceCapitalization(true);
    const { editor, root } = mount('Hello.');
    const text = textChild(root);
    const spy = spyOnValueAssignment(text);

    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant();
        if (!(node instanceof TextNode)) throw new Error('missing text');
        node.setTextContent('Hello. ');
      },
      { discrete: true }
    );
    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant();
        if (!(node instanceof TextNode)) throw new Error('missing text');
        node.setTextContent('Hello. W');
        node.select(8, 8);
      },
      { discrete: true }
    );

    expect(text.data).toBe('Hello. W');
    expect(spy.insertData).toHaveBeenNthCalledWith(1, 6, ' ');
    expect(spy.insertData).toHaveBeenNthCalledWith(2, 7, 'W');
    expect(spy.writes()).toBe(0);
    editor.read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error('missing caret');
      expect(selection.anchor.offset).toBe(8);
      expect(selection.focus.offset).toBe(8);
    });
  });

  test('inserts inside bold and code text, where the text node is nested', () => {
    restoreInstall = installIosSentenceCapitalization(true);
    for (const format of ['bold', 'code'] as const) {
      const { editor, root } = mount('Hello.', format);
      const text = textChild(root);
      const insertData = vi.spyOn(text, 'insertData');

      editor.update(
        () => {
          const node = $getRoot().getFirstDescendant();
          if (!(node instanceof TextNode)) throw new Error('missing text');
          node.setTextContent('Hello. W');
        },
        { discrete: true }
      );

      expect(text.data).toBe('Hello. W');
      expect(insertData).toHaveBeenCalledOnce();
      root.remove();
    }
  });

  test('still replaces the value when text is deleted or rewritten', () => {
    restoreInstall = installIosSentenceCapitalization(true);
    const { editor, root } = mount('Hello.');
    const text = textChild(root);
    const spy = spyOnValueAssignment(text);

    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant();
        if (!(node instanceof TextNode)) throw new Error('missing text');
        node.setTextContent('Hi');
      },
      { discrete: true }
    );

    expect(text.data).toBe('Hi');
    expect(spy.insertData).not.toHaveBeenCalled();
    expect(spy.writes()).toBeGreaterThan(0);
  });

  test('leaves desktop text updates on the value assignment', () => {
    restoreInstall = installIosSentenceCapitalization(false);
    const { editor, root } = mount('Hello.');
    const text = textChild(root);
    const spy = spyOnValueAssignment(text);

    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant();
        if (!(node instanceof TextNode)) throw new Error('missing text');
        node.setTextContent('Hello. W');
      },
      { discrete: true }
    );

    expect(text.data).toBe('Hello. W');
    expect(spy.insertData).not.toHaveBeenCalled();
    expect(spy.writes()).toBeGreaterThan(0);
  });
});
